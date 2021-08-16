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

import { svgRapidFeatures } from './rapid_features';
import { svgRapidFeaturesGL } from './rapid_features_gl';

//##########################################################################

//#region HELPER FUNCTIONS
function newElm( elmName, cls, parent ){
    const elm = document.createElementNS( 'http://www.w3.org/2000/svg', elmName );
    elm.setAttribute( 'class', cls );
    parent.appendChild( elm );
    return elm;
}
//#endregion

//#region LAYER CLASSES
class BaseLayer{
    constructor( id, layer ){
        this.id         = id;
        this.layer      = layer;
        this.isReady    = false;
    }

    // Create Dom Elements to Support the Layer Rendering
    initDom( root ){ console.warn( 'Layer.initDom is not implemented.' ); }

    // Update the Rendering of the layer
    update(){ console.warn( 'Layer.update is not implemented.' ); }

    // Set Size of the Layer
    setSize( v ){ console.warn( 'Layer.setSize is not implemented.' ); }
}

class SVGLayer extends BaseLayer{
    update(){
        //return;
         // Update Layers by calling its Function with a select( svg.g );
        if( this.isReady ) this.layer( this.svgGroup );
    }

    setSize( v ){ utilSetDimensions( this.svg, v ); }

    initDom( root ){
        if ( this.isReady ) return;
        
        //---------------------------
        const svg = newElm( 'svg',    'surface',               root );
                    newElm( 'defs',   'surface-defs',          svg );      // Things Break without defs
                    newElm( 'svg',    'grids-svg',             svg );      
        const g   = newElm( 'g',      'data-layer ' + this.id, svg );

        //---------------------------
        // TODO CSS this, Only doing it this way for Testing why layers aren't appearing, Making it float helps it finally take its w/h
        svg.style.position  = 'absolute';
        svg.style.top       = '0px';
        svg.style.left      = '0px';

        //---------------------------
        this.svgGroup = d3_select( g );    // Layer Functions Expect G Wrapped in a D3 Selection
        this.svg      = d3_select( svg );  // drawLayers.dimensions expect SVG Wrapped in D3 Selection
        this.isReady  = true;

        console.log( 'BUild SVG Layer' );
    }
}

class GLLayer extends BaseLayer{
}

/*
::: NOTES :::
With the amount of things that needs to draw, there is flicker between clear & the drawing being completed.
Possible solution is do something like a buffer swapchain.
*/
class CanvasLayer extends BaseLayer{
    initDom( root ){
        const c = document.createElement( 'canvas' );
        root.appendChild( c );

        this.canvas         = c;
        this.ctx            = c.getContext( '2d', { desynchronized: true } ); //  Desynchronized Only Works in Windows/ChromeOS, Speeds up Rendering
        this.width          = 0;
        this.height         = 0;

        c.style.position        = 'absolute';
        c.style.top             = '0px';
        c.style.left            = '0px';
        c.style.imageRendering  = 'pixelated';  // For Hi Res Screens, make things pixelated instead of blurry

        this.isReady        = true;
    }

    setSize( size ){
        const c         = this.canvas;
        const dpi       = window.devicePixelRatio;
        c.style.width   = size[0] + 'px';
        c.style.height  = size[1] + 'px';
        c.width         = size[0] * dpi;
        c.height        = size[1] * dpi;
        this.width      = size[0];
        this.height     = size[1];
        this.ctx.scale( dpi, dpi );
    }

    update(){
        if ( !this.isReady ) return;

        //this.ctx.clearRect( 0, 0, this.width, this.height );

        //this.ctx.fillStyle = '#ff0000';
        //this.ctx.beginPath();
		//this.ctx.rect( 0, 0, this.width, this.height );
		//this.ctx.fill();

        //this.circle( 10, 10, 50, '#00ff00' );
        this.layer( this );
    }

    clear(){ this.ctx.clearRect( 0, 0, this.width, this.height ); }

    circle( x, y, radius, fillColour=null, strokeColour=null, strokeSize=null ){
        if ( !fillColour && !strokeColour ) return;

		this.ctx.beginPath();
		this.ctx.arc( x, y, radius,0,  Math.PI * 2, false );

        if ( fillColour ){
            this.ctx.fillStyle = fillColour;
            this.ctx.fill();
        }

        if ( strokeColour ){
            if ( strokeSize ) this.ctx.lineWidth = strokeSize;
            this.ctx.strokeStyle = fillColour;
            this.ctx.stroke();
        }

        return this;
    }
}
//#endregion

//##########################################################################

export function svgLayers(projection, context) {
    var dispatch    = d3_dispatch('change');
    var svg         = d3_select(null);

    //===============================================================================
    var _layers     = [
        new SVGLayer( 'ai-features',        svgRapidFeatures( projection, context, dispatch ) ),
        new CanvasLayer( 'ai-features-cv',  svgRapidFeaturesGL( projection, context, dispatch ) ),
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
