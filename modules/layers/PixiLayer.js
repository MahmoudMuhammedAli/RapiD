import BaseLayer    from './BaseLayer.js';
import * as PIXI    from 'pixi.js';

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
        // Add Style Class to Canvas
        let c = this.app.view;
        c.classList.add( 'layer-container' );   // Basic Style for Layer
        c.classList.add( 'ai-layer-gl' );       // Drawing Styles

        //~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
        // Pull Style Information that can be used by the shader to render the Graphics
        const style = window.getComputedStyle( c, null );
        this.styles = {
            point : {
                strokeColor     : getStyleColor( style, '--point-stroke-color', 0x00ff00 ),
                strokeSize      : getStyleFloat( style, '--point-stroke-size', 5 ),
                color           : getStyleColor( style, '--point-color', 0x00ff00 ),
                radius          : getStyleFloat( style, '--point-radius', 10 ),
            },

            line : {
                color           : getStyleColor( style, '--line-color', 0x00ff00 ),
                size            : getStyleFloat( style, '--line-size', 5 ),
            },

            polygon : {
                strokeColor     : getStyleColor(  style, '--polygon-stroke-color', 0x00ff00 ),
                strokeSize      : getStyleFloat(  style, '--polygon-stroke-size', 5 ),
                fillType        : getStyleString( style, '--polygon-fill-type', 'stripes' ),
                fillColorA      : getStyleColor(  style, '--polygon-fill-color-a', 0x00ff00 ),
                fillAngle       : getStyleFloat(  style, '--polygon-fill-angle', 0 ),
                fillLineSpacing : getStyleFloat(  style, '--polygon-fill-line-spacing', 0 ),
                fillLineSize    : getStyleFloat(  style, '--polygon-fill-line-size', 2 ),
            },
        };

        //~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
        // For Quick Prototyping, Going to use the Graphic Object
        // To treat this layer like a 2D Canvas. Maybe down the line
        // figure out a better way to manage drawing entities, things like
        // update polygon vertices without needed to run earcut on them again.
        // But right now we're going to clear and redraw everything for each frame.
        this.patternShader  = diagonalFillPattern();

        this.patternShader.uniforms.angle       = this.styles.polygon.fillAngle;
        this.patternShader.uniforms.thinkness   = this.styles.polygon.fillLineSize;
        this.patternShader.uniforms.spacing     = this.styles.polygon.fillLineSpacing;
        this.patternShader.uniforms.useGrid     = ( this.styles.polygon.fillType === 'stripes' )? 0 : 1;

        this.graphic        = new PIXI.Graphics();
        this.graphic.shader = this.patternShader;

        this.app.stage.addChild( this.graphic );

        this.isReady        = true;
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

    drawGraphicPolygon( flat2DAry, color=this.styles.polygon.fillColorA, strokeSize=this.styles.polygon.strokeSize ){
        //this.graphic.lineStyle( 0 );
        this.graphic.lineStyle( strokeSize, this.styles.polygon.strokeColor, 1 );
        this.graphic.beginFill( color, 0.9 );
        this.graphic.drawPolygon( flat2DAry );
        this.graphic.endFill();
        return this;
    }

    drawGraphicPath( flat2DAry, color=this.styles.line.color, lineSize=this.styles.line.size ){
        this.graphic.lineStyle( lineSize, color, 1 );
        this.graphic.moveTo( flat2DAry[ 0 ], flat2DAry[ 1 ] );
        for ( let i=2; i < flat2DAry.length; i+=2 ){
            this.graphic.lineTo( flat2DAry[ i ], flat2DAry[ i+1 ] );
        }
    }

    drawGraphicCircle( x, y, radius=this.styles.point.radius, color=this.styles.point.color, strokeSize=this.styles.point.strokeSize, strokeColor=this.styles.point.strokeColor ){
        this.graphic.lineStyle( strokeSize, strokeColor, 1 );
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

//#endregion

export default PixiLayer;