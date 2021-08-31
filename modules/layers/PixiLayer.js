import BaseLayer    from './BaseLayer.js';
import * as PIXI    from 'pixi.js';

class PixiLayer extends BaseLayer{
    //#region MAIN
    initDom( parentElm ){
        // Start up Pixi
        this.app = new PIXI.Application( {
            width 			: 500,
            height 			: 500,
            resolution		: window.devicePixelRatio || 1,
            autoDensity     : true,
            antialias       : true,
            backgroundAlpha : 0,
        } );

        parentElm.appendChild( this.app.view );  // Set Pixi's Canvas as a child to Parent Dom Element

        //~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
        // Add Style Class to Canvas
        let c = this.app.view;
        c.classList.add( 'layer-container' );   // Basic Style for Layer
        c.classList.add( 'ai-layer-gl' );       // Drawing Styles

        //~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
        // For Quick Prototyping, Going to use the Graphic Object
        // To treat this layer like a 2D Canvas. Maybe down the line
        // figure out a better way to manage drawing entities, things like
        // update polygon vertices without needed to run earcut on them again.
        // But right now we're going to clear and redraw everything for each frame.
        this.graphic = new PIXI.Graphics();
        this.app.stage.addChild( this.graphic );

        //~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
        this.isReady = true;
    }

    update(){
        if ( !this.isReady ) return;
        this.layer( this, PIXI );
    }
    //#endregion //////////////////////////////////////////////////////////////////////

    //#region GETTERS / SETTERS
    computeStyle(){ return window.getComputedStyle( this.app.view, null ); }

    setSize( size ){
        if ( !this.isReady ) return;
        this.app.renderer.resize( size[0], size[1] );
    }
    //#endregion //////////////////////////////////////////////////////////////////////

    //#region METHODS TO WORK WITH GRAPHIC OBJ
    clearGraphic(){ this.graphic.clear(); return this; }

    drawGraphicPolygon( flat2DAry, fillColor, strokeSize, strokeColor ){
        //this.graphic.lineStyle( 0 );
        this.graphic.lineStyle( strokeSize, strokeColor, 1 );
        this.graphic.beginFill( fillColor, 0.9 );
        this.graphic.drawPolygon( flat2DAry );
        this.graphic.endFill();
        return this;
    }

    drawGraphicPath( flat2DAry, color, lineSize ){
        this.graphic.lineStyle( lineSize, color, 1 );
        this.graphic.moveTo( flat2DAry[ 0 ], flat2DAry[ 1 ] );
        for ( let i=2; i < flat2DAry.length; i+=2 ){
            this.graphic.lineTo( flat2DAry[ i ], flat2DAry[ i+1 ] );
        }
    }

    drawGraphicCircle( x, y, radius, fillColor, strokeSize=0, strokeColor=0x000000 ){
        this.graphic.lineStyle( strokeSize, strokeColor, 1 );
        this.graphic.beginFill( fillColor, 1 );
        this.graphic.drawCircle( x, y, radius );
        this.graphic.endFill();
    }
    //#endregion //////////////////////////////////////////////////////////////////////

    //#region PIXI METHODS
    render(){ this.app.render();            return this; } 
    clear(){  this.app.renderer.clear();    return this; }
    add( o ){ this.app.stage.addChild( o ); return this; }

    // Create & Adds a color sprite to the scene
    colorSprite( color=0xff0000, w=20, h=20, pos=null ){
        const s = new PIXI.Sprite( PIXI.Texture.WHITE );
        s.tint      = color;
        s.width     = w;
        s.height    = h;
        if ( pos ) s.position.set( pos[0], pos[1] );

        this.add( s );
        return s;
    }
    //#endregion //////////////////////////////////////////////////////////////////////
}

export default PixiLayer;