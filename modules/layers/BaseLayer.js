/* eslint-disable no-unused-vars */
/* eslint-disable no-console */
/* eslint-disable class-methods-use-this */

class BaseLayer{
    constructor( id, layer ){
        this.id         = id;       // Name of the Layer
        this.layer      = layer;    // The function Reference to call on Update.
        this.isReady    = false;    // Has InitDom been called
    }

    // Create Dom Elements to Support the Layer Rendering
    initDom( root ){ console.warn( 'Layer.initDom is not implemented.' ); }

    // Update the Rendering of the layer
    update(){ console.warn( 'Layer.update is not implemented.' ); }

    // Set Size of the Layer
    setSize( v ){ console.warn( 'Layer.setSize is not implemented.' ); }
}

export default BaseLayer;