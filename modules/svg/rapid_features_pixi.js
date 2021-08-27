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

export function svgRapidFeaturesPixi( projection, context, dispatch ){
  const RAPID_MAGENTA   = '#da26d3';
  const throttledRedraw = _throttle(() => dispatch.call('change'), 1000);
  const gpxInUrl        = utilStringQs(window.location.hash).gpx;
  let _layer            = d3_select(null);

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


  function render( layer ){
    //~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    // Checks if Ready to Handle Rendering
    if ( !layer.isReady ) return;

    const rapidContext          = context.rapidContext();
    const waitingForTaskExtent  = gpxInUrl && !rapidContext.getTaskExtent();
    if ( waitingForTaskExtent ) return;  // not ready to draw yet, starting up

    //~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    // Gather available Datasets
    const rapidDatasets = rapidContext.datasets();
    const datasets      = Object.values( rapidDatasets )
      .filter( dataset => dataset.added && dataset.enabled );

    //~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    // Render Data
    let ds, geoData;

    layer.clearGraphic();
    for( ds of datasets ){
      geoData = eachDataset( ds );
      if ( geoData?.paths?.length )     drawGeo( layer, geoData.paths, geoData.graph );
      if ( geoData?.vertices?.length )  drawGeo( layer, geoData.vertices, geoData.graph );
      if ( geoData?.points?.length )    drawPoints( layer, geoData.points );
    }
  }


  // Call webservices to get 
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

  //#region DRAWING RELATED

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

  /** Draw Polygon, LineString and Point */
  function drawGeo( layer, pathData, graph ){
    let geo, ary, itm, i, pnt;
      for ( let p of pathData ){
        geo = p.asGeoJSON( graph );
        switch ( geo.type ){
          //~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
          case 'Polygon' :
            // **NOTES**
            // coord = [ [ [x,y],[x,y],[x,y] ], [ [x,y],[x,y],[x,y] ]  ]
            // First and Last Points Tend to Match, Need to remove final point if matches for Pixi Rendering
            ary = geoProjFlatten( geo );
            for ( itm of ary ) layer.drawGraphicPolygon( itm );
          break;

          //~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
          case 'LineString' :
            // **NOTES**
            // coords = [ [x,y], [x,y] ]
            i   = 0;  
            ary = new Array( geo.coordinates.length * 2 );
            for( itm of geo.coordinates ){
              pnt        = projection( itm );
              ary[ i++ ] = pnt[ 0 ];
              ary[ i++ ] = pnt[ 1 ];
            }
            layer.drawGraphicPath( ary );
          break;

          //~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
          case 'Point' :
            // **NOTES**
            // coords = [ x, y ]
            pnt = projection( geo.coordinates );
            layer.drawGraphicCircle( pnt[0], pnt[1] );
          break;

          //~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
          default : console.error( 'Unknown Geo Type : ', geo.type ); break;
        }
      }
  }

  function drawPoints( layer, pointData ){
    console.log( 'DRAW POINTS', pointData  );
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
