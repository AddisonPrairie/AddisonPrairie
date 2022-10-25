let source = `
//do not delete the following comments!

//none of your parameters can have the following names:
//frames, canvas, groups, position, forward, right, pinhole, zoom, reset
//pathtrace, epsilon, iterations, temp1, bounces, sunpos, floor, focallength
//aperture, breakout

//additionally, the following words cannot be used in code:
//E, PI, seed, first, depth

//put any uniforms here, in the format:
//name : type, //[input method]
//valid input methods: [default value] or [default, min, max, step]
//valid types: i32, f32, u32, vec[1,2,3,4]<i32/f32/u32>
 cutoff : f32, //[1.45, .1, 10., .01]
 kdiv : f32, //[1.16, .01, 2., .01]
 fIterations : i32, //[6, 2, 20, 1]

//Code:
fn DE(z : vec3<f32>) -> f32 {
	return max(fractal(z), length(z) - uniforms.cutoff);
}

fn fractal(  z : vec3<f32> ) -> f32
{
	var p = z;
    var scale = 1.;

    for( var i=0; i< uniforms.fIterations; i = i + 1 )
	{
		p = -1.0 + 2.0*fract(0.5*p+0.5);

        p = p - sign(p)*0.1; //iq's trick (amplified)
        
        var a=f32(i)*acos(-1.)/4.; //my trick
        
        var rot = mat2x2<f32>(cos(a),sin(a),-sin(a),cos(a)) * p.xz;
        
        p = vec3<f32>(rot.x, p.y, rot.y);

        
        var r2 = dot(p,p);
		var k = uniforms.kdiv/r2;
		p     = p * k;
		scale = scale * k;
	}

    var d1 = sqrt( min( min( dot(p.xy,p.xy), dot(p.yz,p.yz) ), dot(p.zx,p.zx) ) ) - 0.02;
    var d2 = abs(p.y);
    var dmi = d2;
    var adr = 0.7*floor((0.5*p.y+0.5)*8.0);
    if( d1<d2 )
    {
        dmi = d1;
        adr = 0.0;
    }
    return vec3<f32>( 0.5*dmi/scale, adr, 1. ).x;
}

fn getColor(z : vec3<f32>) -> vec3<f32> {
    return vec3<f32>(1.);
}`;

//global
let uniforms;
let wgpu;
let canvas;
let gui;
let input;
let modal;
let codemirror;
//also handles input values
let guiValues = {
    position: {x: -1.0276388411780184, y: -1.1951843701696436, z: 0.9366258437615865},
    theta1: -0.7837528341454572,
    theta2: 0.5551147021341948,
    forward: {x: Math.sqrt(2) / 2, y: Math.sqrt(2) / 2, z: 0},
    right: {x: -Math.sqrt(2) / 2, y: Math.sqrt(2) / 2, z: 0},
    sensitivity: .1,
    speed: .1,
    zoom: 1.1,
    reset: false,
    pathtrace: true,
    floor: false,
    detail: .001,
    iterations: 170,
    temp1: 1.,
    light_bounces: 3,
    sun_x: .36,
    sun_y: 0.33,
    power: 1.,
    focal_length: 1.,
    aperture: 0.,
    mouseX: 1.,
    mouseY: 1.,
    breakout: 30.,
    depth: 0.01,
    mouseChanged: false,
    rotateIgnore: false,
    download: () => { //save the content of the canvas
        var link = document.createElement('a');
        link.download = "download.png";
        link.href = document.getElementById('canvas').toDataURL();
        link.click();
    },
    "Pause/Play": () => {
        guiValues.pause = !guiValues.pause;
        if (!guiValues.pause) {
            window.requestAnimationFrame(frame);
        }
    },
    pause: false,
    "Code": () => {
        if (modal.style.display === "none") {
            modal.style.display = "block";
            if (guiValues.pause == false) {
                guiValues["Pause/Play"]();
            }
        } else {
            modal.style.display = "none";
            if (guiValues.pause == true) {
                guiValues["Pause/Play"]();
            }
        }
    },
    "Compile": async () => {
        console.log("Compiling start...");
        //pause rendering while buffers are destroyed and recreated
        if (guiValues.pause == false) {
            guiValues["Pause/Play"]();
        };
        await wgpu.reset(codemirror.getDoc().getValue());
        guiValues["Pause/Play"]();
        console.log("Compile finished");
    },
    "initRefocus": () => {
        guiValues.rotateIgnore = true;
        //<a target="_blank" href="https://icons8.com/icon/38033/full-screen">Full Screen</a> icon by <a target="_blank" href="https://icons8.com">Icons8</a>
        document.body.style = "cursor: zoom-in";//url(/icons8-full-screen-100.png);";
        let toDo = (e) => {
            e.preventDefault();
            document.removeEventListener("mousedown", toDo);
            guiValues.flipState(document.createEvent("HTMLEvents"));
            guiValues.rotateIgnore = false;
            document.body.style.cursor = "default";
        }; 
        document.addEventListener("mousedown", toDo);
    }
};

//if any of these values are different, then the renderer should reset
let lastValues = {
    detail: .01,
    iterations: 100,
    temp1: 1.,
    light_bounces: 2,
    sun_x: .2,
    sun_y: 0.,
    power: 8.,
    iterations: 170,
    aperture: 1.,
    focal_length: 1.,
    zoom: 1.1,
    breakout: 40.,
    floor: false
}

//links guiValues to uniform values
/*
example: {
    name: "center"
    guiNames: ["centerX", "centerY", "centerZ"]
}
*/
let userVariables = {
    arr: []
};

//render frame
async function frame() {
    let changed = canvas.changed();

    if (guiValues.pause) {
        return;
    }

    //if canvas size has changed, buffer sizes of gpu must be updated
    if (changed) {
        await wgpu.resize(changed);
    }

    if (guiValues.pause) {
        return;
    }

    //set uniforms for frame
    refreshUniforms();

    if (guiValues.pause) {
        return;
    }

    //update uniforms each frame
    await wgpu.updateUniforms(uniforms);

    if (guiValues.pause) {
        return;
    }

    //get render result
    let result = await wgpu.render();

    if (guiValues.pause) {
        return;
    }

    //put result to canvas
    canvas.putImage(result);

    if (guiValues.pause) {
        return;
    }

    if (guiValues.pause) {
        return;
    }

    //request next frame
    window.requestAnimationFrame(frame);
}

//if a gui value changed, set reset to true
function checkChanged() {
    //iterate through variables
    var changed = false;
    for (var x in lastValues) {
        if (lastValues[x] != guiValues[x]) {
            changed = true;
            lastValues[x] = guiValues[x];
        }
    }
    //return true if something changed
    return changed;
}

//set uniforms each frame
function refreshUniforms() {
    if (guiValues.rotateIgnore == true) {
        guiValues.focal_length = Math.floor(guiValues.depth * 1000.) / 1000.;
    }

    if (checkChanged()) {
        guiValues.reset = true;
    }

    //set accurate canvas size
    let size = canvas.getSize();
    uniforms.canvas.val = [size.width, size.height];

    //set accurate number of workers on gpu
    uniforms.groups.val = [size.width + ((16 - (size.width % 16)) % 16), size.height + ((16 - (size.height % 16)) % 16)];

    //increase frame count
    uniforms.frames.val[0]++;

    //set position
    uniforms.position.val = [guiValues.position.x, guiValues.position.y, guiValues.position.z];

    //set rotation
    uniforms.forward.val = [guiValues.forward.x, guiValues.forward.y, guiValues.forward.z];
    uniforms.right.val = [guiValues.right.x, guiValues.right.y, guiValues.right.z];

    //set pinhole distance
    uniforms.pinhole.val = [guiValues.zoom];

    //set camera width (zoom)
    uniforms.zoom.val = [1. / 128.];

    //set reset
    uniforms.reset.val = [guiValues.reset ? 1 : 0];
    guiValues.reset = false;

    //set pathtrace
    uniforms.pathtrace.val = [guiValues.pathtrace ? 1 : 0];

    //set epsilon (min dist)
    uniforms.epsilon.val = [guiValues.detail];

    //set iterations value
    uniforms.iterations.val = [guiValues.iterations];

    //set temp values
    uniforms.temp1.val = [guiValues.temp1];

    //set number of light bounces
    uniforms.bounces.val = [guiValues.light_bounces];

    //set sun position
    uniforms.sunpos.val = [guiValues.sun_x, guiValues.sun_y];

    //set floor true / false
    uniforms.floor.val = [guiValues.floor ? 1 : 0];

    //set DOF variables
    uniforms.focallength.val = [guiValues.focal_length];
    uniforms.aperture.val = [guiValues.aperture];

    //set breakout distance
    uniforms.breakout.val = [guiValues.breakout];

    refreshUserVariables();
}

//sets the user "snippet" variables, i.e. copies the guiValues to the stronger uniforms object
//solves different dimensions of inputs
function refreshUserVariables() {
    for (var x in userVariables.arr) {
        
        let cur = userVariables.arr[x];
        let val = [];
        //get array of values
        for (y in cur.guiNames) {
            val[val.length] = guiValues[cur.guiNames[y]];
        }

        uniforms[cur.name].val = val;
    }
}

//initialize gui
function initGui() {

    const basicFolder = gui.addFolder('Basic Lighting and Environment Controls');
    basicFolder.open();
    {//pathtracing
        basicFolder.add(guiValues, 'pathtrace').name("Path Trace");
        basicFolder.add(guiValues, 'sun_y', 0., 1., .01).name("Time of Day");
        basicFolder.add(guiValues, 'sun_x', 0., 1., .01).name("Sun Location");
        basicFolder.add(guiValues, 'light_bounces', 1).name("Light Bounces (2-10)");
        basicFolder.add(guiValues, 'floor').name("Floor");
        basicFolder.add(guiValues, 'download').name("Download Image");
        basicFolder.add(guiValues, 'Pause/Play').name("Pause/Continue Rendering");
    }

    basicFolder.domElement.parentNode.querySelectorAll(".cr").forEach(
        x => {
           x.style = "border-left: 3px solid #2FA1D6"; 
        }
    );
    
    const advancedFolder = gui.addFolder("Advanced Controls");
    {
        const cameraSub = advancedFolder.addFolder('Camera');
        cameraSub.open();
        {
            cameraSub.add(guiValues, 'zoom').name("Zoom (.5-5)");
            //cameraSub.add(guiValues, 'depth').listen().name("Depth under cursor: ");
            cameraSub.add(guiValues, 'initRefocus').name("Select Focus Point");
            //cameraSub.add(guiValues, 'focal_length').name("Focal Length");
            cameraSub.add(guiValues, 'aperture').name("Depth of Field (0-5)");
            //need to add depth reading
        }

        const raymarchingFolder = advancedFolder.addFolder('Ray Marching');
        raymarchingFolder.open();
        {
            raymarchingFolder.add(guiValues, 'detail').name("Detail/Epsilon (0<)");
            raymarchingFolder.add(guiValues, 'iterations').name("Iterations (50<)");
            raymarchingFolder.add(guiValues, 'breakout').name("Breakout (2<)");
        }

        const codeFolder = advancedFolder.addFolder("Code");
        codeFolder.open();
        {//add required variables/buttons to interact with code
            codeFolder.add(guiValues, "Code").name("Open/Close Code");
            //compile code and reset uniforms
            codeFolder.add(guiValues, "Compile").name("Compile Code");
        }

        const controlsFolder = advancedFolder.addFolder("Movement Controls");
        controlsFolder.open();
        {
            controlsFolder.add(guiValues, "speed").name("Movement Speed");
            controlsFolder.add(guiValues, "sensitivity").name("Mouse Sensitivity");
        }

        const caminfoFolder = advancedFolder.addFolder("Camera Positioning Information");
        {
            
            caminfoFolder.add(guiValues.position, "x").listen().name("X Position");
            caminfoFolder.add(guiValues.position, "y").listen().name("Y Position");
            caminfoFolder.add(guiValues.position, "z").listen().name("Z Position");
            caminfoFolder.add(guiValues, "theta1").listen().name("Camera Z Angle");
            caminfoFolder.add(guiValues, "theta2").listen().name("Camera Forward Angle");
        }
    }

    advancedFolder.domElement.parentNode.querySelectorAll(".cr").forEach(
        x => {
            x.style = "border-left: 3px solid grey";
        }
    );
}

//initialize the functionality of the modal
function initModal() {
    modal = document.querySelector(".modal");
    modal.style.display = "none";

    //close code window when something outside of it is clicked
    window.addEventListener("click", (e) => {
        if (e.target === modal) {
            guiValues["Code"]();
        }
    });
}

window.onload = async () => {
    //uniforms
    uniforms =  {
        frames: {
            type: "i32",
            dim: 1,
            val: [1]
        },
        canvas: {
            type: "i32",
            dim: 2,
            val: [300, 300]
        },
        groups: {
            type: "i32",
            dim: 2,
            val: [300, 300]
        },
        position: {
            type: "f32",
            dim: 3,
            val: [0., 0., 0.]
        },
        forward: {
            type: "f32",
            dim: 3,
            val: [0., 0., 0.]
        },
        right: {
            type: "f32",
            dim: 3,
            val: [0., 0., 0.]
        },
        pinhole: {
            type: "f32",
            dim: 1,
            val: [0.]
        },
        zoom: {
            type: "f32",
            dim: 1,
            val: [1.]
        },
        reset: {
            type: "i32",
            dim: 1,
            val: [0.]
        },
        pathtrace: {
            type: "i32",
            dim: 1,
            val: [0.]
        },
        epsilon: {
            type: "f32",
            dim: 1,
            val: [0.]
        },
        iterations: {
            type: "i32",
            dim: 1,
            val: [0.]
        },
        temp1: {
            type: "f32",
            dim: 1,
            val: [0.]
        },
        bounces: {
            type: "i32",
            dim: 1,
            val: [2]
        },
        sunpos: {
            type: "f32",
            dim: 2,
            val: [.2, 0.]
        },
        floor: {
            type: "i32",
            dim: 1,
            val: [0]
        },
        focallength: {
            type: "f32",
            dim: 1,
            val: [1]
        },
        aperture: {
            type: "f32",
            dim: 1,
            val: [1]
        },
        breakout: {
            type: "f32",
            dim: 1,
            val: [50]
        }
    };

    //lets me delete a folder
    //https://stackoverflow.com/questions/18085540/remove-folder-in-dat-gui
    dat.GUI.prototype.removeFolder = function(name) {
        var folder = this.__folders[name];
        if (!folder) {
          return;
        }
        folder.close();
        this.__ul.removeChild(folder.domElement.parentNode);
        delete this.__folders[name];
        this.onResize();
    }

    codemirror = CodeMirror(
        document.querySelector("#code"),
        {
            simple: true,
            mode: "wgsl",
            tabsize: 2,
            lineNumbers: true,
            value: source
        }
    );

    initModal();

    //dat GUI
    gui = new dat.GUI({
        hideable: false
    });

    initGui();

    //encapsulated canvas functionality
    canvas = new Canvas("canvas");

    //gpu interface
    wgpu = new gpu({
        shaderCode: "/shader/main.wgsl",
        canvasX: canvas.getSize().width,
        canvasY: canvas.getSize().height,
        uniforms: uniforms,
        guiValues: guiValues,
        lastValues: lastValues,
        userVariables: userVariables,
        gui: gui
    });

    //fetch code from server
    await wgpu.baseCode();
    

    //gets non-gui input
    input = new Input(guiValues, canvas.getCanvas());

    //let buf = new ArrayBuffer(256 * 256 * 256);

    await guiValues["Compile"]();

    //begin render loop
    window.requestAnimationFrame(frame);
};