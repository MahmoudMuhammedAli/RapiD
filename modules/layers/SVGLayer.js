import BaseLayer                from './BaseLayer.js';
import { select as d3_select }  from 'd3-selection';
import { utilSetDimensions }    from '../util/dimensions';

//#region HELPER FUNCTIONS
function newElm( elmName, cls, parent ){
    const elm = document.createElementNS( 'http://www.w3.org/2000/svg', elmName );
    elm.setAttribute( 'class', cls );
    parent.appendChild( elm );
    return elm;
}
//#endregion

class SVGLayer extends BaseLayer{
    update(){
        // Update Layers by calling its Function with a select( svg.g );
        if ( this.isReady ) this.layer( this.svgGroup );
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
        svg.classList.add( 'layer-container' );

        //---------------------------
        this.svgGroup = d3_select( g );    // Layer Functions Expect G Wrapped in a D3 Selection
        this.svg      = d3_select( svg );  // drawLayers.dimensions expect SVG Wrapped in D3 Selection
        this.isReady  = true;
    }
}

export default SVGLayer;