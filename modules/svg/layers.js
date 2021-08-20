import { dispatch as d3_dispatch } from 'd3-dispatch';
import { select as d3_select } from 'd3-selection';
import { utilArrayDifference } from '@id-sdk/util';

import { svgData } from './data';
import { svgDebug } from './debug';
import { svgGeolocate } from './geolocate';
import { svgKeepRight } from './keepRight';
import { svgImproveOSM } from './improveOSM';
import { svgOsmose } from './osmose';
import { svgStreetside } from './streetside';
import { svgMapillaryImages } from './mapillary_images';
import { svgMapillaryPosition } from './mapillary_position';
import { svgMapillarySigns } from './mapillary_signs';
import { svgMapillaryMapFeatures } from './mapillary_map_features';
import { svgOpenstreetcamImages } from './openstreetcam_images';
import { svgOsm } from './osm';
import { svgNotes } from './notes';
import { svgTouch } from './touch';
import { utilRebind } from '../util';
import { utilGetDimensions, utilSetDimensions } from '../util/dimensions';

import { svgRapidFeatures }         from './rapid_features';
import { svgRapidFeaturesCanvas }   from './rapid_features_canvas';
import { svgRapidFeaturesPixi }     from './rapid_features_pixi';
import { SVGLayer, CanvasLayer, PixiLayer } from "../layers/index.js";

//##########################################################################

export function svgLayers(projection, context) {
    var dispatch    = d3_dispatch('change');
    var svg         = d3_select(null);

    //===============================================================================
    var _layers     = [
        new SVGLayer( 'ai-features',        svgRapidFeatures( projection, context, dispatch ) ),
        //new CanvasLayer( 'ai-features-cv',  svgRapidFeaturesCanvas( projection, context, dispatch ) ),
        new PixiLayer( 'ai-features-px',    svgRapidFeaturesPixi( projection, context, dispatch ) ),
        //new SVGLayer( 'osm',                svgOsm( projection, context, dispatch ) ),
        /*
        { id: 'ai-features', layer: svgRapidFeatures(projection, context, dispatch) },
        { id: 'osm', layer: svgOsm(projection, context, dispatch) },
        { id: 'notes', layer: svgNotes(projection, context, dispatch) },
        { id: 'data', layer: svgData(projection, context, dispatch) },
        { id: 'keepRight', layer: svgKeepRight(projection, context, dispatch) },
        { id: 'improveOSM', layer: svgImproveOSM(projection, context, dispatch) },
        { id: 'osmose', layer: svgOsmose(projection, context, dispatch) },
        { id: 'streetside', layer: svgStreetside(projection, context, dispatch)},
        { id: 'mapillary', layer: svgMapillaryImages(projection, context, dispatch) },
        { id: 'mapillary-position', layer: svgMapillaryPosition(projection, context, dispatch) },
        { id: 'mapillary-map-features',  layer: svgMapillaryMapFeatures(projection, context, dispatch) },
        { id: 'mapillary-signs',  layer: svgMapillarySigns(projection, context, dispatch) },
        { id: 'openstreetcam', layer: svgOpenstreetcamImages(projection, context, dispatch) },
        { id: 'debug', layer: svgDebug(projection, context, dispatch) },
        { id: 'geolocate', layer: svgGeolocate(projection, context, dispatch) },
        { id: 'touch', layer: svgTouch(projection, context, dispatch) }
        */
    ];

    //===============================================================================
    // Have Each layer build its DOM Requirements for rendering
    let hasBuildDom = false;
    function initBuildDom( root ){
        console.log( 'INIT BUILD' );

        //-------------------------------------------
        // Create a SVG Object for Each Data Layer in the Array
        let l;
        for ( l of _layers ) l.initDom( root );

        //-------------------------------------------
        hasBuildDom = true;
    }


    function drawLayers(selection) {
        const root = selection.node();
        /*
        let USE_OLD = false;

        //~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
        if( USE_OLD ){
        svg = selection.selectAll('.surface')
            .data([0]);

        svg = svg.enter()
            .append('svg')
            .attr('class', 'surface')
            .merge(svg);

        var defs = svg.selectAll('.surface-defs')
            .data([0]);

        defs.enter()
            .append('defs')
            .attr('class', 'surface-defs');

        defs.enter()
            .append('svg')
            .attr('class', 'grids-svg');

        var groups = svg.selectAll('.data-layer')
            .data(_layers);

        groups.exit()
            .remove();

        groups.enter()
            .append('g')
            .attr('class', function(d) { return 'data-layer ' + d.id; })
            .merge(groups)
            .each(function(d) { d3_select(this).call(d.layer); });
        }

        //~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
        if( !USE_OLD ){
        */
            if ( !hasBuildDom ){
                hasBuildDom = true;
                initBuildDom( root );   // Create DOM Elements JIT
                svg = selection.selectAll( '.surface' );
            }
            
            //for ( const l of _layers ) l.layer( d3_select( l.svgGroup ) );   // Update Layers by calling its Function with a select( svg.g );
            //for ( const l of _layers ) l.layer( l.svgGroup );   // Update Layers by calling its Function with a select( svg.g );
            for ( const l of _layers ) l.update();
        //}
        //console.log( 'DRAW LAYERS DONE', selection );
    }

    drawLayers.all = function() {
        return _layers;
    };


    drawLayers.layer = function(id) {
        var obj = _layers.find(function(o) { return o.id === id; });
        return obj && obj.layer;
    };


    drawLayers.only = function(what) {
        var arr = [].concat(what);
        var all = _layers.map(function(layer) { return layer.id; });
        return drawLayers.remove(utilArrayDifference(all, arr));
    };


    drawLayers.remove = function(what) {
        var arr = [].concat(what);
        arr.forEach(function(id) {
            _layers = _layers.filter(function(o) { return o.id !== id; });
        });
        dispatch.call('change');
        return this;
    };


    drawLayers.add = function(what) {
        var arr = [].concat(what);
        arr.forEach(function(obj) {
            if ('id' in obj && 'layer' in obj) {
                _layers.push(obj);
            }
        });
        dispatch.call('change');
        return this;
    };


    drawLayers.dimensions = function(val) {
        //console.log( 'SET DIMENSIONS', val, svg );
        /*
        if (!arguments.length) return utilGetDimensions(svg);
        utilSetDimensions( svg, val );

        //~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
        */
        if ( !arguments.length ) return utilGetDimensions( _layers[0].svg ); // TODO: This line is BAD, Figure out a better way to get Size
        for ( const l of _layers ){
            if ( !l.isReady ) continue;
            //utilSetDimensions( l.svg, val );
            l.setSize( val );
        }

        return this;
    };


    return utilRebind(drawLayers, dispatch, 'on');
}
