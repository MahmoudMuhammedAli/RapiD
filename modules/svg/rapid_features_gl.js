import _throttle from 'lodash-es/throttle';

import { select as d3_select} from 'd3-selection';
import { geoScaleToZoom } from '@id-sdk/geo';
import { services } from '../services';
import { svgPath, svgPointTransform } from './index';
import { utilStringQs } from '../util';
import { GraphDataProvider } from 'mapillary-js';

let _enabled = false;
let _initialized = false;
let _FbMlService;
let _EsriService;
let _actioned;

// #region WEB WORKERS

class DynamicWorker{
  constructor( fn, useInit=false ){
      //~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
      const src  = ( !useInit )? fn.toString() : '(' + fn.toString() + ')()';
      const blob = new Blob(
          [ 'self.onmessage=', src ],
          { type:'text/javascript' }
      );

      //~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
      const url  = window.URL.createObjectURL( blob );
      window.URL.revokeObjectURL(blob);

      //~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
      this._worker = new Worker( url );
  }

  post( data ){ this._worker.postMessage( data ); return this; }

  once( fn ){ this._worker.addEventListener( 'message', fn, { once:true } ); return this; }
  on( fn ){ this._worker.addEventListener( 'message', fn ); return this; }
}

function FNPolygonComputeWorker(){
  //~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
  // Projection Math
  const project = ( point, proj ) => {
    const lambda = point[ 0 ] * 0.01745329251;
    const phi    = Math.log( Math.tan( ( 1.5707963267948966 + ( point[ 1 ] * 0.01745329251 ) ) * 0.5 ) );
    return [
      proj.x + lambda * proj.k,
      proj.y - phi    * proj.k,
    ];
  };

  //~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
  // Return Function
  return e => {
    //-----------------------------------
    const proj   = e.data.proj;   // Extra data needed to handle projection to tile ( I think )
    const geoAry = e.data.geoAry; // Collection of Polygon Data in Geo Coords
    let g, c, i;

    //-----------------------------------
    for ( g of geoAry ){                       // Each Polygorn Object
      for ( c of g.coordinates ){              // ...Has a collection of Coordinates
        for ( i=0; i < c.length; i++ ){        // ...Which consists of an ary of Vec2
          // Strange behavior trying to change the individual element of c[i][n]
          // Wrong values get copied over plus many NaN errors. If replacing the subarray
          // with a brand new array was the only way to get the data correctly back into
          // the existing structure.
          c[ i ] = project( c[ i ], proj );
        }
      }
    }

    //-----------------------------------
    // Send Modified Data Back to Main Thread.
    self.postMessage( geoAry );
  };
}

// #emdregion

export function svgRapidFeaturesGL(projection, context, dispatch) {
  const RAPID_MAGENTA   = '#da26d3';
  const throttledRedraw = _throttle(() => dispatch.call('change'), 1000);
  const gpxInUrl        = utilStringQs(window.location.hash).gpx;
  let _layer            = d3_select(null);


  const polygonComputeWorker = new DynamicWorker( FNPolygonComputeWorker, true );


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


  function render( canvas ){
    // TODO: Hacking together how eachDataset works into this function to learn what the data looks like
    // and see if there is any fat to trim thats only needed for SVG related operations

    const rapidContext  = context.rapidContext();
    const rapidDatasets = rapidContext.datasets();
    const datasets = Object.values(rapidDatasets)
      .filter(dataset => dataset.added && dataset.enabled);

    const dItem   = datasets[ 1 ];
    const service = dItem.service === 'fbml' ? getFbMlService(): getEsriService();
    if (!service) return;
  
    // Adjust the dataset id for whether we want the data conflated or not.
    const internalID = dItem.id + (dItem.conflated ? '-conflated' : '');
    const graph = service.graph(internalID);

    //~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    canvas.clear();
    if ( context.map().zoom() >= context.minEditableZoom() ) {
      if (dItem.service === 'fbml') {

        service.loadTiles( internalID, projection, rapidContext.getTaskExtent() );
        let pathData = service
          .intersects( internalID, context.map().extent() )
          .filter( d => d.type === 'way' && !_actioned.has(d.id) && !_actioned.has(d.__origid__) )  // see onHistoryRestore()
          ;//.filter( getPath ); 


        let paths = pathData.filter( isArea );
        if( paths.length > 0 ){
          // Can't pass functions to WebWorkers, So most of the Projection Algorithm now lives there BUT
          // Still need 3 values to pass to make it all work X,Y,K.
          const projInfo   = projection.getInfo();

          // Create an Array of Poly Structures in Geo Coord Space that can be sent to a WebWorker
          const pathCoords = new Array( paths.length );
          for( let i=0; i < paths.length; i++ ){
            pathCoords[ i ] = paths[ i ].asGeoJSON( graph );
          }

          // TODO : Doing once because need reference to canvas, If this object holds the layer's reference, wont need to
          // create a once event that carries the canvas reference with itself. When webworker finishes its work, it
          // posts a message page with all the polygons in Pixel Space, Ready for drawing in Canvas.
          polygonComputeWorker.once( e => {
            const ary = e.data;
            let poly, coord, pnt;

            for ( poly of ary ){                 
              for ( coord of poly.coordinates ){  // Poly is made of multiple sub polys basicly
                for ( pnt of coord ){             // Points of the Sub Poly in Pixel Space
                  canvas.circle( pnt[0], pnt[1], 5, '#ff0000' );
                }
              }
            }

          });

          // Pass PolyGons and Projection info to WebWorker.
          polygonComputeWorker.post( { proj:projInfo, geoAry:pathCoords } );
        }
      }
      
      /*
      const projection2 = ( point, proj ) => {
        const lambda = point[0] * 0.01745329251;
        const phi    = Math.log( Math.tan( ( 1.5707963267948966 + (point[1] * 0.01745329251) ) / 2) );
        return [
          lambda * proj.k + proj.x,
          proj.y - phi * proj.k
        ];
      };

      
      for ( let p of paths ){

        let geo = p.asGeoJSON( graph );
        //console.log( '--Geo', geo );

        for ( let coord of geo.coordinates[0] ){
          //let pntx = projection( coord );
          let pnt = projection2( coord, projInfo );
          console.log( "PNT", coord, pnt );
          //console.log( pnt, pntx );
          //console.log( "pnt", pnt );
          canvas.circle( pnt[0], pnt[1], 5, '#ff0000' );
        }

        //console.log( "PATHS", getPath( p ) );
        //console.log( projection );
      }
      */
      

    }//else


  }


  function eachDataset(dataset, i, nodes) {
    const rapidContext = context.rapidContext();
    const selection = d3_select(nodes[i]);
    const service = dataset.service === 'fbml' ? getFbMlService(): getEsriService();
    if (!service) return;

    // Adjust the dataset id for whether we want the data conflated or not.
    const internalID = dataset.id + (dataset.conflated ? '-conflated' : '');
    const graph = service.graph(internalID);
    const getPath = svgPath(projection, graph);
    const getTransform = svgPointTransform(projection);

    // Gather data
    let geoData = {
      paths: [],
      vertices: [],
      points: []
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

    selection
      .call(drawPaths, geoData.paths, dataset, getPath)
      .call(drawVertices, geoData.vertices, getTransform)
      .call(drawPoints, geoData.points, getTransform);
  }


  function drawPaths(selection, pathData, dataset, getPath) {
    // Draw shadow, casing, stroke layers
    let linegroups = selection
      .selectAll('g.linegroup')
      .data(['shadow', 'casing', 'stroke']);

    linegroups = linegroups.enter()
      .append('g')
      .attr('class', d => `linegroup linegroup-${d}`)
      .merge(linegroups);

    // Draw paths
    let paths = linegroups
      .selectAll('path')
      .data(pathData, featureKey);

    // exit
    paths.exit()
      .remove();

    // enter/update
    paths = paths.enter()
      .append('path')
      .attr('style', d => isArea(d) ? `fill: url(#fill-${dataset.id})` : null)
      .attr('class', (d, i, nodes) => {
        const currNode = nodes[i];
        const linegroup = currNode.parentNode.__data__;
        const klass = isArea(d) ? 'building' : 'road';
        return `line ${linegroup} ${klass} data${d.__fbid__}`;
      })
      .merge(paths)
      .attr('d', getPath);
  }


  function drawVertices(selection, vertexData, getTransform) {
    const vertRadii = {
      //       z16-, z17,  z18+
      stroke: [3.5,  4,    4.5],
      fill:   [2,    2,    2.5]
    };

    let vertexGroup = selection
      .selectAll('g.vertexgroup')
      .data(vertexData.length ? [0] : []);

    vertexGroup.exit()
      .remove();

    vertexGroup = vertexGroup.enter()
      .append('g')
      .attr('class', 'vertexgroup')
      .merge(vertexGroup);


    let vertices = vertexGroup
      .selectAll('g.vertex')
      .data(vertexData, d => d.id);

    // exit
    vertices.exit()
      .remove();

    // enter
    let enter = vertices.enter()
      .append('g')
      .attr('class', d => `node vertex ${d.id}`);

    enter
      .append('circle')
      .attr('class', 'stroke');

    enter
      .append('circle')
      .attr('class', 'fill');

    // update
    const zoom = geoScaleToZoom(projection.scale());
    const radiusIdx = (zoom < 17 ? 0 : zoom < 18 ? 1 : 2);
    vertices = vertices
      .merge(enter)
      .attr('transform', getTransform)
      .call(selection => {
        ['stroke', 'fill'].forEach(klass => {
          selection.selectAll('.' + klass)
            .attr('r', vertRadii[klass][radiusIdx]);
        });
      });
  }


  function drawPoints(selection, pointData, getTransform) {
    const pointRadii = {
      //       z16-, z17,  z18+
      shadow: [4.5,   7,   8],
      stroke: [4.5,   7,   8],
      fill:   [2.5,   4,   5]
    };

    let pointGroup = selection
      .selectAll('g.pointgroup')
      .data(pointData.length ? [0] : []);

    pointGroup.exit()
      .remove();

    pointGroup = pointGroup.enter()
      .append('g')
      .attr('class', 'pointgroup')
      .merge(pointGroup);

    let points = pointGroup
      .selectAll('g.point')
      .data(pointData, featureKey);

    // exit
    points.exit()
      .remove();

    // enter
    let enter = points.enter()
      .append('g')
      .attr('class', d => `node point data${d.__fbid__}`);

    enter
      .append('circle')
      .attr('class', 'shadow');

    enter
      .append('circle')
      .attr('class', 'stroke');

    enter
      .append('circle')
      .attr('class', 'fill');

    // update
    const zoom = geoScaleToZoom(projection.scale());
    const radiusIdx = (zoom < 17 ? 0 : zoom < 18 ? 1 : 2);
    points = points
      .merge(enter)
      .attr('transform', getTransform)
      .call(selection => {
        ['shadow', 'stroke', 'fill'].forEach(klass => {
          selection.selectAll('.' + klass)
            .attr('r', pointRadii[klass][radiusIdx]);
        });
      });
  }


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
