//#region IMPORT & GLOBAL VARIABLES
import _throttle                      from 'lodash-es/throttle';
import { select as d3_select}         from 'd3-selection';
import { geoScaleToZoom }             from '@id-sdk/geo';
import { services }                   from '../services';
import { svgPath, svgPointTransform } from './index';
import { utilStringQs }               from '../util';
import { GraphDataProvider }          from 'mapillary-js';
import * as PIXI                      from 'pixi.js';
import osm from '../services/osm';
import { list } from 'postcss';
import { timeHours } from 'd3-time';

let _enabled = false;
let _initialized = false;
let _FbMlService;
let _EsriService;
let _actioned;

//#endregion //////////////////////////////////////////////////////////////////////


//#region FILL PATTERN SHADER

function fillPatternShader(){
  const VERT_SRC = `
precision highp float;
attribute vec2  aVertexPosition;
attribute vec2  aTextureCoord;
attribute vec4  aColor;
attribute float aTextureId;

uniform mat3    projectionMatrix;
uniform mat3    translationMatrix;
uniform vec4    tint;           // Required, Graphic Will Fail Rendering if this is missing.

varying vec2    vTextureCoord;
varying vec4    vColor;
varying float   vTextureId;

void main(void){
  gl_Position     = vec4(( projectionMatrix * translationMatrix * vec3(aVertexPosition, 1.0) ).xy, 0.0, 1.0);
  vTextureCoord   = aTextureCoord;
  vTextureId      = aTextureId;
  vColor          = aColor * tint;
}
`;

const FRAG_SRC = `
varying vec2  vTextureCoord;
varying vec4  vColor;
varying float vTextureId;

uniform vec2  resolution;
uniform float angle;        // TODO: Better to pass in Mat2 Rotation from CPU, then to compute it for each pixel.
uniform float thinkness;
uniform float spacing;
uniform int   useGrid;

vec2 rotateCoord( vec2 uv, float rads ){
  uv *= mat2( cos(rads), sin(rads), -sin(rads), cos(rads) );
  return uv;
}

vec2 grid( vec2 fragCoord, float space, float gridWidth ){
  vec2 p    = fragCoord - 0.5;
  vec2 size = vec2( gridWidth - 0.5 );
  
  vec2 a1 = mod( p - size, space );
  vec2 a2 = mod( p + size, space );
  vec2 a  = a2 - a1;
     
  //float g = min( a.x, a.y );
  //return clamp( g, 0.0, 1.0 );
  return a;
}

void main(void){
  //gl_FragColor = vec4( 1.0, 0.0, 0.0, 1.0 );

  if( vColor.a > 0.999 ) gl_FragColor = vColor;
  else{
      //vec2 uv         = gl_FragCoord.xy / resolution;
      //float interval  = 10.0;
      //float a         = step( mod( gl_FragCoord.x + gl_FragCoord.y, interval ) / ( interval - 1.0 ), 0.3 );
      //gl_FragColor    = vec4( a * vColor.rgb, a );

      vec2  fragCoord = vec2( gl_FragCoord.x, resolution.y - gl_FragCoord.y ); // Flip Y Coordnate so origin is Upper Left 
      vec2  grad      =  grid( rotateCoord( fragCoord, radians( angle ) ), spacing, thinkness );
      float a         = ( useGrid == 1 )? clamp( min( grad.x, grad.y ), 0.0, 1.0 ) : grad.y;
      a = 1.0 - a;

      gl_FragColor    = vec4( a * vColor.rgb, a );
  }
  /**/
}
`;
  // TODO: Need set the Canvas Width/Height.
  // TODO: See if UBOs are possible with Pixy, so one place to update the resolution for all the shaders to use.
  return PIXI.Shader.from( VERT_SRC, FRAG_SRC, { 
      tint        : [0,0,0,0],
      resolution  : [ window.innerWidth, window.innerHeight ],
      angle       : 45,
      thinkness   : 1.1,
      spacing     : 7,
      useGrid     : 1,
  });
}

//#endregion //////////////////////////////////////////////////////////////////////


//#region GET STYLE FUNCTIONS

function getStyleColor( style, sname, defaultValue ){
  const val = style.getPropertyValue( sname );
  return ( val !== '' )?
      parseInt( val.replace( '#', '0x' ), 16 ) :
      defaultValue;
}

function getStyleFloat( style, sname, defaultValue ){
  const val = style.getPropertyValue( sname );
  return ( val !== '' )? parseFloat( val ) : defaultValue;
}

function getStyleString( style, sname, defaultValue ){
  const val = style.getPropertyValue( sname );
  return ( val !== '' )? val.replaceAll( '"', '' ).trim() : defaultValue;
}

//#endregion //////////////////////////////////////////////////////////////////////


//#region OBJECT POOL
class ObjectPoolItem {
  constructor(obj) {
      this.inUse  = false;
      this.obj    = obj;
  }
}

class ObjectPool {
  constructor(fnNew = null) {
      this.items = [];
      this.avail = [];
      this.onNew = fnNew;
  }
  _createNew() {
      if (!this.onNew)
          return undefined;
      const i = new ObjectPoolItem(this.onNew());
      this.items.push(i);
      return i;
  }
  get() {
      const i = (this.avail.length != 0) ? this.avail.pop() : this._createNew();
      if (!i)
          return null;
      i.inUse = true;
      return i.obj;
  }
  recycle(o) {
      let i;
      for (i of this.items) {
          if (i.obj === o) {
              i.inUse = false;
              this.avail.push(i);
              break;
          }
      }
      return this;
  }

  static nanoId( t=21 ){
      const r = crypto.getRandomValues( new Uint8Array( t ) );
      let n, e = "";
          
      for( ;t--; ){
          n  = 63 & r[ t ];
          e += ( n < 36 )? n.toString(36) : 
               ( n < 62 )? ( n - 26 ).toString( 36 ).toUpperCase() : 
               ( n < 63 )? "_" : "-";
      }
      return e;
  }
}
//#endregion //////////////////////////////////////////////////////////////////////

class DrawableManager{
  constructor( layer ){
    // Caching whats currently in the scene graph
    this.cache      = new Map();

    // 
    this.layer      = null;
    this.mainShader = null;

    // Pool of Pixi.Graphic Objects
    this.pool       = new ObjectPool( this.newGraphic.bind( this ) );
  }

  //#region CALLBACKS & EVENTS
  // Builder function for the ObjectPool
  newGraphic(){
    const g       = new PIXI.Graphics();
    g.name        = null;
    g.interactive = true;
    g.buttonMode  = true;
    g.shader      = this.mainShader; // TODO, Pixi is not using the shader for some reason.

    // Pixi tries to Batch Render items in a Geometry Object. When it feels like it can
    // batch the render, it completely ignores the shader thats assigned. It only uses the
    // shader if it deems it can not be batched. So overriding the isBatchable function
    // is the only way to make sure Graphic always uses the shader assigned to it.
    g.geometry.isBatchable = ()=>{ return false };

    g.on( 'click',        e=>this.onGraphicClick( g ) );
    g.on( 'pointerover',  e=>this.onGraphicOver( g ) );
    g.on( 'pointerout',   e=>this.onGraphicOut( g ) );

    //console.log( `%c NEW GRAPHIC `, 'color: #00ffff; background: #030307; padding:5px 0;' );
    return g;
  }

  onGraphicClick( g ){
    console.log( "Clicking on", g.name );
  }

  onGraphicOver( g ){
    console.log( "Mouse Over", g.name );
  }

  onGraphicOut( g ){
    console.log( "Mouse out", g.name );
  }
  //#endregion

  //#region MANAGE CACHES
  updateCache( idSet ){
    const lists = this.compareMapCache( idSet, this.cache );

    //console.log( "FILTERED LIST", lists );

    if( lists.old.length > 0 ) this.recycleObjects( this.cache, lists.old );
    if( lists.new.length > 0 ) this.createObjects( this.cache, lists.new );
  }

  clearCache(){
    let obj;
    for( obj of this.cache.values() ){
      this.layer.remove( obj );     // Remove from Scene
      this.pool.recycle( obj );     // Return back to Pool
    }
    this.cache.clear();
  }

  recycleObjects( map, idAry ){
    let itmId, obj;

    //console.log( "RecycleObjects", idAry );

    for( itmId of idAry ){
      obj = map.get( itmId );
      //console.log( " -- RECYCLE OBJECT", itmId, obj );

      if( obj ){
        this.layer.remove( obj );     // Remove from Scene
        this.pool.recycle( obj );     // Return back to Pool
        this.cache.delete( itmId );   // Remove Cache Reference
      }else{
        console.warn( "No Graphic Object found for recycling", itmId );
      }
    }
  }

  createObjects( objMap, idAry ){
    let itmId, obj;

    for( itmId of idAry ){
      obj       = this.pool.get();
      obj.name  = itmId;

      objMap.set( itmId, obj ); // Save Object to Map
      this.layer.add( obj );    // Add Object to Scene
    }
  }

  compareMapCache( newSet, oldMap ){
    const rtn = { new:[], common:[], old:[] };

    let i;
    for( i of oldMap.keys() ) if( !newSet.has( i ) ) rtn.old.push( i );   // Item not in new Set
    for( i of newSet ){
        if( oldMap.has( i ) ) rtn.common.push( i );                       // Item in both sets
        else                  rtn.new.push( i );                          // Item only in new Set
    }

    return rtn;
  }

  //#endregion

  //#region HELPERS
  // Create a set of IDs from the Osm Data Array
  makeOsmIdSet( osmAry ){
    const rtn = new Set();
    let elm;
    for( elm of osmAry ) rtn.add( elm.id );
    return rtn;
  }
  //#endregion

  //#region DRAWING
  drawPathPolygon( id, pntAry, style ){
    let obj = this.cache.get( id );
    if( obj ){
      let points;
      obj.clear();
      //console.log( "Draw Polygon", obj.shader );
      //console.log( pntAry );

      for( points of pntAry ){
        obj.lineStyle( style.strokeSize, style.strokeColor, 1 );
        obj.beginFill( style.fillColorA, 0.9 );
        obj.drawPolygon( points );
        obj.endFill();
      }
    }else{
      console.warn( "drawPathPolygon : did not find id in map", id );
    }
  }

  drawPathLine( id, pntAry, style ){
    let obj = this.cache.get( id );
    if( obj ){
      obj.clear();
      obj.lineStyle( style.size, style.color, 1 );
      obj.moveTo( pntAry[ 0 ], pntAry[ 1 ] );

      for ( let i=2; i < pntAry.length; i+=2 ){
        obj.lineTo( pntAry[ i ], pntAry[ i+1 ] );
      }
    }else{
      console.warn( "drawPathLine : did not find id in map", id );
    }
  }
  
  drawVertices( id, x, y, style ){
    let obj = this.cache.get( id );
    if( obj ){
      obj.clear();
      obj.lineStyle( style.strokeSize, style.strokeColor, 1 );
      obj.beginFill( style.color, 1 );
      obj.drawCircle( x, y, style.radius );
      obj.endFill();
    }else{
      console.warn( "drawVertices : did not find id in map", id );
    }
  }

  drawPoints( id, x, y, style ){
    let obj = this.cache.get( id );
    if( obj ){
      obj.clear();

      // Background Circle : Bigger wtih Fill & Stroke
      obj.lineStyle( style.strokeSize, style.strokeColor, 1 );
      obj.beginFill( style.colorOut, 1 );
      obj.drawCircle( x, y, style.radiusOut );
      obj.endFill();

      // Forground Circle : Smaller with Fill Only
      obj.lineStyle( 0 );
      obj.beginFill( style.colorIn, 1 );
      obj.drawCircle( x, y, style.radiusIn );
      obj.endFill();

    }else{
      console.warn( "drawPoints : did not find id in map", id );
    }
  }
  //#endregion
}

export function svgRapidFeaturesPixiExt( projection, context, dispatch ){
  const RAPID_MAGENTA   = '#da26d3';
  const throttledRedraw = _throttle(() => dispatch.call('change'), 1000);
  const gpxInUrl        = utilStringQs(window.location.hash).gpx;
  let _layer            = d3_select(null);

  let styles            = null;
  let drawManager       = new DrawableManager();

  function init() {
    if (_initialized) return;  // run once

    _enabled = true;
    _initialized = true;
    _actioned = new Set();

    // Watch history to synchronize the displayed layer with features
    // that have been accepted or rejected by the user.
    context.history().on('undone.aifeatures', onHistoryUndone);
    context.history().on('change.aifeatures', onHistoryChange);
    context.history().on('restore.aifeatures', onHistoryRestore);
  }


  // Services are loosly coupled in iD, so we use these functions
  // to gain access to them, and bind the event handlers a single time.
  function getFbMlService() {
    if (services.fbMLRoads && !_FbMlService) {
      _FbMlService = services.fbMLRoads;
      _FbMlService.event.on('loadedData', throttledRedraw);
    }
    return _FbMlService;
  }

  function getEsriService() {
    if (services.esriData && !_EsriService) {
      _EsriService = services.esriData;
      _EsriService.event.on('loadedData', throttledRedraw);
    }
    return _EsriService;
  }


  function wasRapidEdit(annotation) {
    return annotation && annotation.type && /^rapid/.test(annotation.type);
  }


  function onHistoryUndone(currentStack, previousStack) {
    const annotation = previousStack.annotation;
    if (!wasRapidEdit(annotation)) return;

    _actioned.delete(annotation.id);
    if (_enabled) { dispatch.call('change'); }  // redraw
  }


  function onHistoryChange(/* difference */) {
    const annotation = context.history().peekAnnotation();
    if (!wasRapidEdit(annotation)) return;

    _actioned.add(annotation.id);
    if (_enabled) { dispatch.call('change'); }  // redraw
  }


  function onHistoryRestore() {
    _actioned = new Set();
    context.history().peekAllAnnotations().forEach(annotation => {
      if (wasRapidEdit(annotation)) {
        _actioned.add(annotation.id);
        // origid (the original entity ID), a.k.a. datum.__origid__,
        // is a hack used to deal with non-deterministic way-splitting
        // in the roads service. Each way "split" will have an origid
        // attribute for the original way it was derived from. In this
        // particular case, restoring from history on page reload, we
        // prevent new splits (possibly different from before the page
        // reload) from being displayed by storing the origid and
        // checking against it in render().
        if (annotation.origid) {
          _actioned.add(annotation.origid);
        }
      }
    });
    if (_actioned.size && _enabled) {
      dispatch.call('change');  // redraw
    }
  }


  function showLayer() {
    throttledRedraw();
    layerOn();
  }


  function hideLayer() {
    throttledRedraw.cancel();
    layerOff();
  }


  function layerOn() {
    _layer.style('display', 'block');
  }


  function layerOff() {
    _layer.style('display', 'none');
  }


  function isArea(d) {
    return (d.type === 'relation' || (d.type === 'way' && d.isArea()));
  }


  function featureKey(d) {
    return d.__fbid__;
  }


  function loadStyles( layer ){
    //~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    // GRAB STYLE SHEET INFORMATION FROM DOM ELEMENT OF THE LAYER

    const s = layer.computeStyle();

    styles = {
      vertices : {
          strokeColor     : getStyleColor( s, '--vertices-stroke-color', 0x00ff00 ),
          strokeSize      : getStyleFloat( s, '--vertices-stroke-size', 5 ),
          color           : getStyleColor( s, '--vertices-color', 0x00ff00 ),
          radius          : getStyleFloat( s, '--vertices-radius', 10 ),
      },

      point : {
          strokeColor     : getStyleColor( s, '--point-stroke-color', 0x00ff00 ),
          strokeSize      : getStyleFloat( s, '--point-stroke-size', 5 ),
          colorIn         : getStyleColor( s, '--point-color-in', 0x00ff00 ),
          colorOut        : getStyleColor( s, '--point-color-out', 0x00ff00 ),
          radiusIn        : getStyleFloat( s, '--point-radius-in', 5 ),
          radiusOut       : getStyleFloat( s, '--point-radius-out', 8 ),
      },

      line : {
          color           : getStyleColor( s, '--line-color', 0x00ff00 ),
          size            : getStyleFloat( s, '--line-size', 5 ),
      },

      polygon : {
          strokeColor     : getStyleColor(  s, '--polygon-stroke-color', 0x00ff00 ),
          strokeSize      : getStyleFloat(  s, '--polygon-stroke-size', 5 ),
          fillType        : getStyleString( s, '--polygon-fill-type', 'stripes' ),
          fillColorA      : getStyleColor(  s, '--polygon-fill-color-a', 0x00ff00 ),
          fillAngle       : getStyleFloat(  s, '--polygon-fill-angle', 0 ),
          fillLineSpacing : getStyleFloat(  s, '--polygon-fill-line-spacing', 0 ),
          fillLineSize    : getStyleFloat(  s, '--polygon-fill-line-size', 2 ),
      },
    };

    //~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    // LOAD UP A FILL PATTERN SHADER TO USE FOR RENDERING POLYGONS
    const fillShader = fillPatternShader();
    fillShader.uniforms.angle       = styles.polygon.fillAngle;
    fillShader.uniforms.thinkness   = styles.polygon.fillLineSize;
    fillShader.uniforms.spacing     = styles.polygon.fillLineSpacing;
    fillShader.uniforms.useGrid     = ( styles.polygon.fillType === 'stripes' )? 0 : 1;

    layer.graphic.shader    = fillShader;
    drawManager.mainShader  = fillShader;

    console.log( "[ FILL SHADER READY ]" );
    return fillShader;
  }


  function render( layer ){
    //~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    // Checks if Ready to Handle Rendering

    if ( !layer.isReady ) return;
    if( !styles )         loadStyles( layer );  // Once layer is ready. Start grabbing custom style values.

    const rapidContext          = context.rapidContext();
    const waitingForTaskExtent  = gpxInUrl && !rapidContext.getTaskExtent();
    if ( waitingForTaskExtent ) return;  // not ready to draw yet, starting up

    if( !drawManager.layer ) drawManager.layer = layer;

    //~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    // Gather available Datasets
    const rapidDatasets = rapidContext.datasets();
    const datasets      = Object.values( rapidDatasets )
      .filter( dataset => dataset.added && dataset.enabled );

    //~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    // Get all the datasets and built a list of items to be drawn for this frame
    let i, ds, geoData;
    let aryDatasets = new Array();
    let idSet       = new Set();
    let isEmpty     = true;

    for( ds of datasets ){
      geoData = eachDataset( ds );
      isEmpty = true;

      if ( geoData?.paths?.length ){    isEmpty=false; for( i of geoData.paths )     idSet.add( i.id ); }
      if ( geoData?.vertices?.length ){ isEmpty=false;  for( i of geoData.vertices ) idSet.add( i.id ); }
      if ( geoData?.points?.length ){   isEmpty=false; for( i of geoData.points )    idSet.add( i.id ); }

      if( !isEmpty ) aryDatasets.push( geoData );
    }

    //console.log( "Frame Item IDs", idSet );
    // If there are no items to be drawn, clear out the draw cache.
    if( idSet.length == 0 ){
      drawManager.clearCache();
      return;
    }
    
    // If Items exists, run update to recycle unused drawing entities.
    drawManager.updateCache( idSet );
    
    //~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    // Render Data
    layer.clearGraphic(); // TODO, Remove PixiLayer's Global Graphic when its not longer needed. Ext doesn't use this
    
    for( geoData of aryDatasets ){
      if ( geoData?.paths?.length ){    drawPaths( layer, geoData.paths, geoData.graph );        }
      if ( geoData?.vertices?.length ){ drawVertices( layer, geoData.vertices, geoData.graph );  }
      if ( geoData?.points?.length ){   drawPoints( layer, geoData.points, geoData.graph );      }
    }
  }


  function eachDataset( dataset ){ //, i, nodes
    const rapidContext = context.rapidContext();
    //const selection = d3_select(nodes[i]);
    const service = dataset.service === 'fbml' ? getFbMlService(): getEsriService();
    if (!service) return;

    // Adjust the dataset id for whether we want the data conflated or not.
    const internalID    = dataset.id + (dataset.conflated ? '-conflated' : '');
    const graph         = service.graph( internalID );
    const getPath       = svgPath( projection, graph );
    //const getTransform  = svgPointTransform( projection );

    // Gather data
    let geoData = {
      graph     : graph,
      paths     : [],
      vertices  : [],
      points    : []
    };

    if (context.map().zoom() >= context.minEditableZoom()) {
      /* Facebook AI/ML */
      if (dataset.service === 'fbml') {

        service.loadTiles(internalID, projection, rapidContext.getTaskExtent());
        let pathData = service
          .intersects(internalID, context.map().extent())
          .filter(d => d.type === 'way' && !_actioned.has(d.id) && !_actioned.has(d.__origid__) )  // see onHistoryRestore()
          .filter(getPath);

        // fb_ai service gives us roads and buildings together,
        // so filter further according to which dataset we're drawing
        if (dataset.id === 'fbRoads' || dataset.id === 'rapid_intro_graph') {
          geoData.paths = pathData.filter(d => !!d.tags.highway);

          let seen = {};
          geoData.paths.forEach(d => {
            const first = d.first();
            const last = d.last();
            if (!seen[first]) {
              seen[first] = true;
              geoData.vertices.push(graph.entity(first));
            }
            if (!seen[last]) {
              seen[last] = true;
              geoData.vertices.push(graph.entity(last));
            }
          });

        } else if (dataset.id === 'msBuildings') {
          geoData.paths = pathData.filter(isArea);
          // no vertices

        } else {
          // esri data via fb service
          geoData.paths = pathData.filter(isArea);
        }

      /* ESRI ArcGIS */
      } else if (dataset.service === 'esri') {
        service.loadTiles(internalID, projection);
        let visibleData = service
          .intersects(internalID, context.map().extent())
          .filter(d => !_actioned.has(d.id) && !_actioned.has(d.__origid__) );  // see onHistoryRestore()

        geoData.points = visibleData
          .filter(d => d.type === 'node' && !!d.__fbid__);  // standalone only (not vertices/childnodes)

        geoData.paths = visibleData
          .filter(d => d.type === 'way' || d.type === 'relation')
          .filter(getPath);
      }
    }

    //selection
    //  .call(drawPaths, geoData.paths, dataset, getPath)
    //  .call(drawVertices, geoData.vertices, getTransform)
    //  .call(drawPoints, geoData.points, getTransform);
    return geoData;
  }

  //#region DRAWING FUNCTIONS

  /** Take a Geo Object, Project Polygon Geo coord to Pixel Coords while saving the results in an array of flat arrays */
  function geoProjFlatten( geo ){
    const flatArys  = new Array( geo.coordinates.length ); // PreAllocate Array
    let j, i, ii, pnts, eIdx, flat, p;

    for ( [ j, pnts ] of geo.coordinates.entries() ){
      eIdx = pnts.length - 1; // Get Final Index
      //~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
      // Exclude Final Point if its a repeat of the first Point
      if ( pnts[0][0] === pnts[ eIdx ][0] &&
            pnts[0][1] === pnts[ eIdx ][1] ) eIdx--;

      //~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
      ii   = 0;                           // Reset Allocator Index
      flat = new Array( (eIdx+1) * 2 );   // Preallocate Flat Array, 2 Numbers Per Coordinate Point

      for ( i=0; i <= eIdx; i++ ){
        p            = projection( pnts[ i ] ); // Convert Geo Coords to Pixel Coords
        flat[ ii++ ] = p[ 0 ];                  // Save results to flat array
        flat[ ii++ ] = p[ 1 ];
      }

      //~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
      flatArys[ j ] = flat;
    }

    return flatArys;
  }

  /** Draw Polygon, LineString */
  function drawPaths( layer, pathData, graph ){
    // Recycle any graphics that aren't being used with the new Data. 

    let geo, ary, itm, i, pnt;
    for ( let p of pathData ){
      
      geo = p.asGeoJSON( graph );
      //console.log( "---", p.id, geo.type );

      switch ( geo.type ){
        //~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
        case 'Polygon' :
          // **NOTES** coord = [ [ [x,y],[x,y],[x,y] ], [ [x,y],[x,y],[x,y] ]  ]
          // First and Last Points Tend to Match, Need to remove final point if matches for Pixi Rendering
          ary = geoProjFlatten( geo );
          drawManager.drawPathPolygon( p.id, ary, styles.polygon );
          
          /*
          for ( itm of ary )
          layer.drawGraphicPolygon( 
            itm,
            styles.polygon.fillColorA,
            styles.polygon.strokeSize,
            styles.polygon.strokeColor,
          );
          */

        break;

        //~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
        case 'LineString' :
          // **NOTES**  coords = [ [x,y], [x,y] ]
          // Project + Flatten the Points
          i   = 0;  
          ary = new Array( geo.coordinates.length * 2 );
          for( itm of geo.coordinates ){
            pnt        = projection( itm );
            ary[ i++ ] = pnt[ 0 ];
            ary[ i++ ] = pnt[ 1 ];
          } 

          drawManager.drawPathLine( p.id, ary, styles.line );

          //layer.drawGraphicPath( ary, styles.line.color, styles.line.size );
        break;

        //~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
        default : console.error( 'Unknown Path Type : ', geo.type ); break;
      }
    }
  }

  function drawVertices( layer, pathData, graph ){
    // **NOTES**  geo.coordinates = [ x, y ]

    let p, geo, pnt;
    for ( p of pathData ){
      geo = p.asGeoJSON( graph );        
      pnt = projection( geo.coordinates );

      drawManager.drawVertices( p.id, pnt[ 0 ], pnt[ 1 ], styles.vertices );
      
      /*
      layer.drawGraphicCircle( 
        pnt[ 0 ], pnt[ 1 ], 
        styles.vertices.radius, 
        styles.vertices.color,
        styles.vertices.strokeSize, 
        styles.vertices.strokeColor
      );
      */
    }
  }

  function drawPoints( layer, pathData, graph ){
    // **NOTES**  geo.coordinates = [ x, y ]

    let p, geo, pnt;
    for ( p of pathData ){
      geo = p.asGeoJSON( graph );        
      pnt = projection( geo.coordinates );

      drawManager.drawPoints( p.id, pnt[0], pnt[1], styles.point );

      /*
      // Background Circle : Bigger wtih Fill & Stroke
      layer.drawGraphicCircle( 
        pnt[ 0 ], pnt[ 1 ], 
        styles.point.radiusOut, 
        styles.point.colorOut,
        styles.point.strokeSize, 
        styles.point.strokeColor
      );

      // Forground Circle : Smaller with Fill Only
      layer.drawGraphicCircle( 
        pnt[ 0 ], pnt[ 1 ], 
        styles.point.radiusIn, 
        styles.point.colorIn
      );
      */

    }
  }
  // #endregion


  render.showAll = function() {
    return _enabled;
  };


  render.enabled = function(val) {
    if (!arguments.length) return _enabled;

    _enabled = val;
    if (_enabled) {
      showLayer();
    } else {
      hideLayer();
    }

    dispatch.call('change');
    return render;
  };


  init();
  return render;
}
