
class Canvas {
    canvas;
    width;
    height;
    context;

    //constructed at beginning of program
    constructor(id) {
        this.canvas = document.getElementById(id);
        
        this.init();
    }

    //set canvas resolution 
    setCanvasResolution() {
        //get correct resolution/size
        this.width = Math.ceil(window.innerWidth);
        this.height = Math.ceil(window.innerHeight);
        //set in canvas
        this.canvas.width = this.width;
        this.canvas.height = this.height;
    }

    //called by constructor (and on reset?)
    init() {
        this.context = this.canvas.getContext('2d');
        this.setCanvasResolution();
    }

    //if canvas size changed, reset canvas
    changed() {
        //if it has changed since the last frame
        if (this.width != window.innerWidth || this.height != window.innerHeight) {
            //reset canvas
            this.setCanvasResolution();
            //return width so that upper level can change gpu buffer sizes
            return {
                width: this.width,
                height: this.height
            }
        }
        //return nothing for no change
        return;
    }

    //get size of canvas (for buffer size)
    getSize() {
        return {
            width: this.width,
            height: this.height
        }
    }

    //get the canvas
    getCanvas() {
        return this.canvas;
    }

    //display rendered image on canvas
    putImage(arr) {
        const imageData = new ImageData(arr, this.width + ((16 - (this.width % 16)) % 16), this.height + ((16 - (this.height % 16)) % 16));
        this.context.putImageData(imageData, 0, 0);
    }
}