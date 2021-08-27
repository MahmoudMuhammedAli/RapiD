import BaseLayer from './BaseLayer.js';

/*
::: NOTES :::
With the amount of things that needs to draw, there is flicker between clear & the drawing being completed.
Possible solution is do something like a buffer swapchain.
*/
class CanvasLayer extends BaseLayer{
    initDom( root ){
        const c = document.createElement( 'canvas' );
        root.appendChild( c );

        this.canvas             = c;
        this.ctx                = c.getContext( '2d', { desynchronized: true } ); //  Desynchronized Only Works in Windows/ChromeOS, Speeds up Rendering
        this.width              = 0;
        this.height             = 0;

        c.classList.add( 'layer-container' );
        c.style.imageRendering  = 'pixelated';  // For Hi Res Screens, make things pixelated instead of blurry

        this.isReady            = true;
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
        this.layer( this );
    }

    // #region DRAWING METHODS
    clear(){          this.ctx.clearRect( 0, 0, this.width, this.height ); return this; }
    fillColor( v ){   this.ctx.fillStyle   = v; return this; }
    strokeColor( v ){ this.ctx.strokeStyle = v; return this; }
    lineWidth( v ){   this.ctx.lineWidth   = v; return this; }

    draw( d=1 ){
        if ( (d & 1) === 1 ) this.ctx.fill();
        if ( (d & 2) === 2 ) this.ctx.stroke();
    }

    circle( x, y, radius, draw=1 ){
		this.ctx.beginPath();
		this.ctx.arc( x, y, radius,0,  Math.PI * 2, false );
        this.draw( draw );
        return this;
    }
    // #endregion //////////////////////////////////////////////////////////////////////////////////
}

export default CanvasLayer;