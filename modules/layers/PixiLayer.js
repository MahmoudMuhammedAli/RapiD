import BaseLayer    from './BaseLayer.js';
import PIXI         from './lib/pixi.min.js';

class PixiLayer extends BaseLayer{
    initDom( root ){
        this.app = new PIXI.Application( {
            width 			: 500,
            height 			: 500,
            resolution		: window.devicePixelRatio || 1,
            antialias       : true,
            transparent     : true,
        } );

        root.appendChild( this.app.view );

        //~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
        // Tweak Canvas Styles, Temporary
        let c = this.app.view;
        c.style.position        = 'absolute';   // TODO : Make this a CSS Class
        c.style.top             = '0px';
        c.style.left            = '0px';

        //~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
        // For Quick Prototyping, Going to use the Graphic Object
        // To treat this layer like a 2D Canvas. Maybe down the line
        // figure out a better way to manage drawing entities, things like
        // update polygon vertices without needed to run earcut on them again.
        // But right now we're going to clear and redraw everything for each frame.
        
        this.graphic = new PIXI.Graphics();
        this.app.stage.addChild( this.graphic );

        //~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
        this.isReady            = true;
    }

    setSize( size ){
        if ( !this.isReady ) return;
        this.app.renderer.resize( size[0], size[1] );
    }

    update(){
        if ( !this.isReady ) return;
        this.layer( this, PIXI );
    }

    //#region GRAPHIC METHODS
    clearGraphic(){ this.graphic.clear();   return this; }

    drawGraphicPolygon( flat2DAry, color=0x00ff00 ){
        //this.graphic.lineStyle( 0 );
        //this.graphic.lineStyle( 6, 0xffd900, 1 );
        this.graphic.beginFill( color, 1 );
        this.graphic.drawPolygon( flat2DAry );
        this.graphic.endFill();
        return this;
    }

    drawGraphicCircle( x, y, radius, color=0x00ff00 ){
        this.graphic.beginFill( color, 1 );
        this.graphic.drawCircle( x, y, radius );
        this.graphic.endFill();
    }
    //#endregion //////////////////////////////////////////////////////////////////////

    //#region PIXI METHODS
    render(){ this.app.render();            return this; }
    clear(){  this.app.renderer.clear();    return this; }
    add( o ){ this.app.stage.addChild( o ); return this; }

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