import BaseLayer    from './BaseLayer.js';
import * as PIXI    from 'pixi.js';

class PixiLayer extends BaseLayer{
    initDom( root ){
        this.app = new PIXI.Application( {
            width 			: 500,
            height 			: 500,
            resolution		: window.devicePixelRatio || 1,
            autoDensity     : true,
            antialias       : true,
            backgroundAlpha : 0,
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

        this.patternShader  = diagonalFillPattern();

        this.graphic        = new PIXI.Graphics();
        this.graphic.shader = this.patternShader;

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

    drawGraphicPolygon( flat2DAry, color=0x00ff00, lnStyle=3 ){
        //this.graphic.lineStyle( 0 );
        this.graphic.lineStyle( lnStyle, color, 1 );
        this.graphic.beginFill( color, 0.9 );
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

//#region FILL PATTERN SHADERS

function diagonalFillPattern(){
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

void main(void){
    if( vColor.a > 0.999 ) gl_FragColor = vColor;
    else{
        vec2 uv         = gl_FragCoord.xy / resolution;
        float interval  = 10.0;
        float a         = step( mod( gl_FragCoord.x + gl_FragCoord.y, interval ) / ( interval - 1.0 ), 0.3 );
        gl_FragColor    = vec4( a * vColor.rgb, a );
    }
}
`;
    // TODO: Need set the Canvas Width/Height.
    // TODO: See if UBOs are possible with Pixy, so one place to update the resolution for all the shaders to use.
    return PIXI.Shader.from( VERT_SRC, FRAG_SRC, { tint:[0,0,0,0], resolution:[ window.innerWidth, window.innerHeight ] } );
}

//#endregion

export default PixiLayer;