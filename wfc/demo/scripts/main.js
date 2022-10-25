let GLOBAL = {
    wfc: {
        meshes : {
            pointers : [],
            triangles : []
        },
        params : {
            bounds: {
                x : 8,
                y : 8,
                z : 16
            },
            allEdgeTypes : []
        },
        tiles : [],
        state : null,
        collapsed : false
    }
};

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
    theta2: -0.5,
    forward: {x: Math.sqrt(2) / 2, y: Math.sqrt(2) / 2, z: 0},
    right: {x: -Math.sqrt(2) / 2, y: Math.sqrt(2) / 2, z: 0},
    sensitivity: .2,
    speed: 1,
    zoom: 1.1,
    reset: false,
    pathtrace: true,
    floor: false,
    detail: .001,
    iterations: 170,
    temp1: 1.,
    light_bounces: 3,
    sun_x: .3,
    sun_y: 0.9,
    power: 1.,
    focal_length: 1.,
    aperture: 0.,
    mouseX: 1.,
    mouseY: 1.,
    breakout: 30.,
    depth: 0.01,
    mouseChanged: false,
    rotateIgnore: false,
    distance: 20.,
    airRate: 0.,
    stepsPerFrame: 20,
    boundsX: 8,
    boundsY: 8,
    boundsZ: 16,
    posCenterPoint: {x: GLOBAL.wfc.params.bounds.x / 2., y: GLOBAL.wfc.params.bounds.y / 2., z: GLOBAL.wfc.params.bounds.z / 2.},
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
    "wfc-reset": () => {
        wfc();
    },
    "resetSize": () => {
        guiValues.boundsX = Math.floor(guiValues.boundsX);
        guiValues.boundsY = Math.floor(guiValues.boundsY);
        guiValues.boundsZ = Math.floor(guiValues.boundsZ);

        GLOBAL.wfc.params.bounds.x = guiValues.boundsX;
        GLOBAL.wfc.params.bounds.y = guiValues.boundsY;
        GLOBAL.wfc.params.bounds.z = guiValues.boundsZ;

        wgpu.resizeScene(GLOBAL.wfc.params.bounds);

        uniforms.boundsX.val = [guiValues.boundsX];
        uniforms.boundsY.val = [guiValues.boundsY];
        uniforms.boundsZ.val = [guiValues.boundsZ];

        wfc();

        guiValues.posCenterPoint = {
            x: guiValues.boundsX / 2.,
            y: guiValues.boundsY / 2.,
            z: guiValues.boundsZ / 2.
        };

        input.setForwardAndRight();
        input.setPosition();
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
    floor: false,
    distance: 0.
}

//render frame
async function frame() {
    let changed = canvas.changed();

    for (var i = 0; i < guiValues.stepsPerFrame; i++) {
        if (!GLOBAL.wfc.collapsed) {
            wfcStep();
            guiValues.reset = true;
        }
    }

    wgpu.loadTypes(getTypes(), getRot());

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
    if (changed == true) {
        input.setForwardAndRight();
        input.setPosition();
    }
    //return true if something changed
    return changed;
}

//set uniforms each frame
function refreshUniforms() {
    if (guiValues.rotateIgnore == true) {
        console.log("changing focal length");
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
}

//initialize gui
function initGui() {

    const basicFolder = gui.addFolder('Lighting and Environment Controls');
    basicFolder.open();
    {//pathtracing
        basicFolder.add(guiValues, 'sun_y', 0., 1., .01).name("Time of Day");
        basicFolder.add(guiValues, 'sun_x', 0., 1., .01).name("Sun Location");
        basicFolder.add(guiValues, 'light_bounces', 1).name("Light Bounces (2-10)");
        basicFolder.add(guiValues, 'distance').name("Distance");
    }

    basicFolder.domElement.parentNode.querySelectorAll(".cr").forEach(
        x => {
           x.style = "border-left: 3px solid #2FA1D6"; 
        }
    );
    
    const wfcFolder = gui.addFolder("Sculpture Controls");
    wfcFolder.open();
    {
        wfcFolder.add(guiValues, 'boundsX').name("X-axis (4-16)");
        wfcFolder.add(guiValues, 'boundsY').name("Y-axis (4-16)");
        wfcFolder.add(guiValues, 'boundsZ').name("Z-axis (4-16)");
        wfcFolder.add(guiValues, 'airRate', 0, .99, .01).name("Empty Spaces");
        wfcFolder.add(guiValues, 'stepsPerFrame', 1, 100, 1).name("Generation Speed");
        wfcFolder.add(guiValues, 'resetSize').name("Generate New Sculpture");
        wfcFolder.add(guiValues, 'download').name("Download Image");
    }

    wfcFolder.domElement.parentNode.querySelectorAll(".cr").forEach(
        x => {
            x.style = "border-left: 3px solid #2FA1D6";
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
        },
        boundsX: {
            type: "i32",
            dim: 1,
            val: [GLOBAL.wfc.params.bounds.x]
        },
        boundsY: {
            type: "i32",
            dim: 1,
            val: [GLOBAL.wfc.params.bounds.y]
        },
        boundsZ: {
            type: "i32",
            dim: 1,
            val: [GLOBAL.wfc.params.bounds.z]
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

    //dat GUI
    gui = new dat.GUI({
        hideable: false
    });

    initGui();

    //encapsulated canvas functionality
    canvas = new Canvas("canvas");

    generateTileBuffer();

    //gpu interface
    wgpu = new gpu({
        shaderCode: "/shader/main.wgsl",
        canvasX: canvas.getSize().width,
        canvasY: canvas.getSize().height,
        uniforms: uniforms,
        guiValues: guiValues,
        lastValues: lastValues,
        gui: gui,
        bounds: GLOBAL.wfc.params.bounds,
        meshPointersBufferLength: GLOBAL.wfc.meshes.pointers.length,
        trianglesBufferLength: GLOBAL.wfc.meshes.triangles.length
    });

    await wgpu.prep();

    wgpu.loadMeshes(GLOBAL.wfc.meshes.pointers, GLOBAL.wfc.meshes.triangles);
    

    //gets non-gui input
    input = new Input(guiValues, canvas.getCanvas());

    input.setForwardAndRight();
    input.setPosition();

    wfc();

    //begin render loop
    window.requestAnimationFrame(frame);
};

function getTypes() {
    let bounds = GLOBAL.wfc.params.bounds;

    let returned = new Int32Array(bounds.x * bounds.y * bounds.z);

    for (var x = 0; x < bounds.x; x++) {
        for (var y = 0; y < bounds.y; y++) {
            for (var z = 0; z < bounds.z; z++) {
                setVal(returned, x, y, z,GLOBAL.wfc.tiles[GLOBAL.wfc.state[x][y][z].tile].mesh, bounds);
            }
        }
    }

    return returned;
}

function getRot() {
    let bounds = GLOBAL.wfc.params.bounds;

    let returned = new Int32Array(bounds.x * bounds.y * bounds.z);

    for (var x = 0; x < bounds.x; x++) {
        for (var y = 0; y < bounds.y; y++) {
            for (var z = 0; z < bounds.z; z++) {
                setVal(returned, x, y, z,GLOBAL.wfc.tiles[GLOBAL.wfc.state[x][y][z].tile].rotation, bounds);
            }
        }
    }
    return returned;
}


async function wfc() {
    let tiles = GLOBAL.wfc.tiles;
    let bounds = GLOBAL.wfc.params.bounds;
    let array = [];

    GLOBAL.wfc.collapsed = false;


    GLOBAL.wfc.state = array;

    console.log("CHECK HERE");
    console.log(bounds);

    for (var x = 0; x < bounds.x; x++) {
        array[x] = [];
        for (var y = 0; y < bounds.y; y++) {
            array[x][y] = [];
            for (var z = 0; z < bounds.z; z++) {
                if (z == 0 || x == 0 || y == 0 || x == bounds.x - 1 || y == bounds.y - 1 || z == bounds.z - 1) {
                    array[x][y][z] = {
                        collapsed : true,
                        tile : 0,
                        possible : [0]
                    };
                } else {
                    array[x][y][z] = {
                        collapsed : false,
                        tile : 0,
                        possible : [],
                        dual: []
                    };
    
                    for (var i = 0; i < tiles.length; i++) {
                        array[x][y][z].possible.push(i);
                    }
                }
            }
        }
    }

    console.log(GLOBAL.wfc.tiles);

    newUpdate(bounds.x - 2, bounds.y - 2, bounds.z - 2);

    console.log("break");


    propagateFrom(bounds.x - 2, bounds.y - 2, bounds.z - 2);
}

function wfcStep() {
    var least = leastEntropy();

    collapseTile(least.x, least.y, least.z);
    
    if (newUpdate(least.x, least.y, least.z)) {
        
        propagateFrom(least.x, least.y, least.z);
    }

    propagateFrom(least.x, least.y, least.z, true);
}

function leastEntropy() {
    var leastEntropy = GLOBAL.wfc.tiles.length;
    var leastX = 0;
    var leastY = 0;
    var leastZ = 0;

    var found = false;

    var bounds = GLOBAL.wfc.params.bounds;

    var states = GLOBAL.wfc.state;

    for (var i = 0; i < bounds.x; i++) {
        for (var j = 0; j < bounds.y; j++) {
            for (var k = 0; k < bounds.z; k++) {
                if (states[i][j][k].collapsed === false && states[i][j][k].possible.length <= leastEntropy) {
                    leastX = i;
                    leastY = j;
                    leastZ = k;

                    found = true;

                    leastEntropy = states[i][j][k].possible.length;
                }
            }
        }
    }

    if (!found) {
        GLOBAL.wfc.collapsed = true;
    }

    return {
        x : leastX,
        y : leastY,
        z : leastZ
    };
}

function propagateFrom(x, y, z) {
    if (newUpdate(x + 1, y, z)) {
        propagateFrom(x + 1, y, z);
    }
    if (newUpdate(x, y + 1, z)) {
        propagateFrom(x, y + 1, z);
    }
    if (newUpdate(x, y, z + 1)) {
        propagateFrom(x, y, z + 1);
    }
    if (newUpdate(x - 1, y, z)) {
        propagateFrom(x - 1, y, z);
    }
    if (newUpdate(x, y - 1, z)) {
        propagateFrom(x, y - 1, z);
    }
    if (newUpdate(x, y, z - 1)) {
        propagateFrom(x, y, z - 1);
    }
}

//returns true if there is a decrease in the number of possible tiles
//should now take into effect edge orientation
//0 - any orientation
//-1 / 1 - must go together
//2 - 
function newUpdate(x, y, z) {
    var bounds = GLOBAL.wfc.params.bounds;

    if (x < 0 || x >= bounds.x || y < 0 || y >= bounds.y || z < 0 || z >= bounds.z) {
        return false;
    }

    if (GLOBAL.wfc.state[x][y][z].collapsed === true) {
        return false;
    }

    var constrainedPossible = [];

    const tiles = GLOBAL.wfc.tiles;

    //REQ scheme
    //0 - anything goes
    //-1 / 1 are paired together
    //2 - must have same rotation

    //remove tiles that there does not exist a compatible possible neighbor with
    for (var i = 0; i < GLOBAL.wfc.tiles.length; i++) {

        let curTile = tiles[i];
        let curEdges = curTile.edges;
        let curReq = curTile.edges_req;

        if (z === bounds.z - 1) {

        } else {
            let adj = GLOBAL.wfc.state[x][y][z + 1];
            let found = false;
            for (var j = 0; j < adj.possible.length; j++) {
                let checkTile = tiles[adj.possible[j]];
                if (checkTile.edges[1] != curEdges[0]) {
                    //keep going through
                    continue;
                }
                //now we know the edges are compatible
                if (curReq[0] === 0) {
                    found = true;
                    break;
                } 
                console.log("got past");
                if (curReq[0] === 2) {
                    if (curTile.rotation === checkTile.rotation) {
                        found = true;
                        break;
                    }
                }
            }
            if (found == false) {
                continue;
            }
        }

        if (z === 0) {
        } else {
            let adj = GLOBAL.wfc.state[x][y][z - 1];
            let found = false;
            for (var j = 0; j < adj.possible.length; j++) {
                let checkTile = tiles[adj.possible[j]];
                if (checkTile.edges[0] != curEdges[1]) {
                    //keep going through
                    continue;
                }
                //now we know the edges are compatible
                if (curReq[1] === 0) {
                    found = true;
                    break;
                } 
                console.log("got past");
                if (curReq[1] === 2) {
                    if (curTile.rotation === checkTile.rotation) {
                        found = true;
                        break;
                    }
                }
            }
            if (found == false) {
                continue;
            }
        }

        if (x === bounds.x - 1) {
        } else {
            let adj = GLOBAL.wfc.state[x + 1][y][z];
            let found = false;
            for (var j = 0; j < adj.possible.length; j++) {
                let checkTile = tiles[adj.possible[j]];
                if (checkTile.edges[5] != curEdges[3]) {
                    //keep going through
                    continue;
                }
                //now we know the edges are compatible
                if (curReq[3] === 0) {
                    found = true;
                    break;
                } 
                console.log("got past");
                if (curReq[3] === -checkTile.edges_req[5]) {
                    found = true;
                    break;
                }
            }
            if (found == false) {
                continue;
            }
        }

        if (x === 0) {
        } else {
            let adj = GLOBAL.wfc.state[x - 1][y][z];
            let found = false;
            for (var j = 0; j < adj.possible.length; j++) {
                let checkTile = tiles[adj.possible[j]];
                if (checkTile.edges[3] != curEdges[5]) {
                    //keep going through
                    continue;
                }
                //now we know the edges are compatible
                if (curReq[5] === 0) {
                    found = true;
                    break;
                } 
                console.log("got past");
                if (curReq[5] === -checkTile.edges_req[3]) {
                    found = true;
                    break;
                }
            }
            if (found == false) {
                continue;
            }
        }

        if (y === bounds.y - 1) {
        } else {
            let adj = GLOBAL.wfc.state[x][y + 1][z];
            let found = false;
            for (var j = 0; j < adj.possible.length; j++) {
                let checkTile = tiles[adj.possible[j]];
                if (checkTile.edges[4] != curEdges[2]) {
                    //keep going through
                    continue;
                }
                //now we know the edges are compatible
                if (curReq[2] === 0) {
                    found = true;
                    break;
                } 
                console.log("got past");
                if (curReq[2] === -checkTile.edges_req[4]) {
                    found = true;
                    break;
                }
            }
            if (found == false) {
                continue;
            }
        }

        if (y === 0) {
        } else {
            let adj = GLOBAL.wfc.state[x][y - 1][z];
            let found = false;
            for (var j = 0; j < adj.possible.length; j++) {
                let checkTile = tiles[adj.possible[j]];
                if (checkTile.edges[2] != curEdges[4]) {
                    //keep going through
                    continue;
                }
                //now we know the edges are compatible
                if (curReq[4] === 0) {
                    found = true;
                    break;
                } 
                console.log("got past");
                if (curReq[4] === -checkTile.edges_req[2]) {
                    found = true;
                    break;
                }
            }
            if (found == false) {
                continue;
            }
        }
        //else it satisfies and we can add it to the list
        constrainedPossible.push(i);
    }

    //now constrained possible is an array of the possible tiles, we just need to update and return

    let curSpot = GLOBAL.wfc.state[x][y][z];

    let prevNum = curSpot.possible.length;
    
    curSpot.possible = [];

    for (var i = 0; i < constrainedPossible.length; i++) {
        curSpot.possible.push(constrainedPossible[i]);
    }

    if (curSpot.possible.length === 0) {
        wfc();
    }

    return curSpot.possible.length < prevNum;
}

function collapseTile(x, y, z) {
    var curTile = GLOBAL.wfc.state[x][y][z];

    if (arrContains(curTile.possible, 0)) {
        if (Math.random() < guiValues.airRate) {
            curTile.collapsed = true;
            curTile.tile = 0;
            curTile.possible = [0];
            return;
        }
    }

    curTile.collapsed = true;
    curTile.tile = curTile.possible[Math.floor(curTile.possible.length * Math.random())];

    curTile.possible = [curTile.tile];
}



let tilesText = `
{"tiles":[{"edges":[0,0,0,0,0,0],"rot":0, "triangles":[]},{"edges":[1,1,0,0,0,0],"rot":0,"triangles":[0.250000,0.750000,1.000000,
    0.250000,0.250000,0.000000,
    0.250000,0.750000,0.000000,
    0.250000,0.250000,1.000000,
    0.750000,0.250000,0.000000,
    0.250000,0.250000,0.000000,
    0.750000,0.250000,1.000000,
    0.750000,0.750000,0.000000,
    0.750000,0.250000,0.000000,
    0.750000,0.750000,1.000000,
    0.250000,0.750000,0.000000,
    0.750000,0.750000,0.000000,
    0.250000,0.250000,1.000000,
    0.750000,0.250000,1.000000,
    0.750000,0.250000,0.000000,
    0.250000,0.750000,1.000000,
    0.250000,0.250000,1.000000,
    0.250000,0.250000,0.000000,
    0.750000,0.250000,1.000000,
    0.750000,0.750000,1.000000,
    0.750000,0.750000,0.000000,
    0.750000,0.750000,1.000000,
    0.250000,0.750000,1.000000,
    0.250000,0.750000,0.000000]},{"edges":[1,1,1,1,1,1],"rot":0,"triangles":[0.000000,0.750000,0.750000,
    0.250000,0.750000,0.250000,
    0.250000,0.750000,0.750000,
    0.000000,0.250000,0.750000,
    0.250000,0.750000,0.750000,
    0.250000,0.250000,0.750000,
    0.000000,0.250000,0.250000,
    0.250000,0.250000,0.750000,
    0.250000,0.250000,0.250000,
    0.000000,0.750000,0.250000,
    0.250000,0.250000,0.250000,
    0.250000,0.750000,0.250000,
    0.250000,0.000000,0.750000,
    0.250000,0.250000,0.250000,
    0.250000,0.250000,0.750000,
    0.750000,0.000000,0.750000,
    0.250000,0.250000,0.750000,
    0.750000,0.250000,0.750000,
    0.750000,0.000000,0.250000,
    0.750000,0.250000,0.750000,
    0.750000,0.250000,0.250000,
    0.250000,0.000000,0.250000,
    0.750000,0.250000,0.250000,
    0.250000,0.250000,0.250000,
    1.000000,0.250000,0.750000,
    0.750000,0.250000,0.250000,
    0.750000,0.250000,0.750000,
    1.000000,0.750000,0.750000,
    0.750000,0.250000,0.750000,
    0.750000,0.750000,0.750000,
    1.000000,0.750000,0.250000,
    0.750000,0.750000,0.750000,
    0.750000,0.750000,0.250000,
    1.000000,0.250000,0.250000,
    0.750000,0.750000,0.250000,
    0.750000,0.250000,0.250000,
    0.750000,1.000000,0.750000,
    0.750000,0.750000,0.250000,
    0.750000,0.750000,0.750000,
    0.250000,1.000000,0.750000,
    0.750000,0.750000,0.750000,
    0.250000,0.750000,0.750000,
    0.250000,1.000000,0.250000,
    0.250000,0.750000,0.750000,
    0.250000,0.750000,0.250000,
    0.750000,1.000000,0.250000,
    0.250000,0.750000,0.250000,
    0.750000,0.750000,0.250000,
    0.750000,0.250000,0.000000,
    0.250000,0.250000,0.250000,
    0.750000,0.250000,0.250000,
    0.750000,0.750000,0.000000,
    0.750000,0.250000,0.250000,
    0.750000,0.750000,0.250000,
    0.250000,0.750000,0.000000,
    0.750000,0.750000,0.250000,
    0.250000,0.750000,0.250000,
    0.250000,0.250000,0.000000,
    0.250000,0.750000,0.250000,
    0.250000,0.250000,0.250000,
    0.250000,0.250000,1.000000,
    0.750000,0.250000,0.750000,
    0.250000,0.250000,0.750000,
    0.250000,0.750000,1.000000,
    0.250000,0.250000,0.750000,
    0.250000,0.750000,0.750000,
    0.750000,0.750000,1.000000,
    0.250000,0.750000,0.750000,
    0.750000,0.750000,0.750000,
    0.750000,0.250000,1.000000,
    0.750000,0.750000,0.750000,
    0.750000,0.250000,0.750000,
    0.000000,0.750000,0.750000,
    0.000000,0.750000,0.250000,
    0.250000,0.750000,0.250000,
    0.000000,0.250000,0.750000,
    0.000000,0.750000,0.750000,
    0.250000,0.750000,0.750000,
    0.000000,0.250000,0.250000,
    0.000000,0.250000,0.750000,
    0.250000,0.250000,0.750000,
    0.000000,0.750000,0.250000,
    0.000000,0.250000,0.250000,
    0.250000,0.250000,0.250000,
    0.250000,0.000000,0.750000,
    0.250000,0.000000,0.250000,
    0.250000,0.250000,0.250000,
    0.750000,0.000000,0.750000,
    0.250000,0.000000,0.750000,
    0.250000,0.250000,0.750000,
    0.750000,0.000000,0.250000,
    0.750000,0.000000,0.750000,
    0.750000,0.250000,0.750000,
    0.250000,0.000000,0.250000,
    0.750000,0.000000,0.250000,
    0.750000,0.250000,0.250000,
    1.000000,0.250000,0.750000,
    1.000000,0.250000,0.250000,
    0.750000,0.250000,0.250000,
    1.000000,0.750000,0.750000,
    1.000000,0.250000,0.750000,
    0.750000,0.250000,0.750000,
    1.000000,0.750000,0.250000,
    1.000000,0.750000,0.750000,
    0.750000,0.750000,0.750000,
    1.000000,0.250000,0.250000,
    1.000000,0.750000,0.250000,
    0.750000,0.750000,0.250000,
    0.750000,1.000000,0.750000,
    0.750000,1.000000,0.250000,
    0.750000,0.750000,0.250000,
    0.250000,1.000000,0.750000,
    0.750000,1.000000,0.750000,
    0.750000,0.750000,0.750000,
    0.250000,1.000000,0.250000,
    0.250000,1.000000,0.750000,
    0.250000,0.750000,0.750000,
    0.750000,1.000000,0.250000,
    0.250000,1.000000,0.250000,
    0.250000,0.750000,0.250000,
    0.750000,0.250000,0.000000,
    0.250000,0.250000,0.000000,
    0.250000,0.250000,0.250000,
    0.750000,0.750000,0.000000,
    0.750000,0.250000,0.000000,
    0.750000,0.250000,0.250000,
    0.250000,0.750000,0.000000,
    0.750000,0.750000,0.000000,
    0.750000,0.750000,0.250000,
    0.250000,0.250000,0.000000,
    0.250000,0.750000,0.000000,
    0.250000,0.750000,0.250000,
    0.250000,0.250000,1.000000,
    0.750000,0.250000,1.000000,
    0.750000,0.250000,0.750000,
    0.250000,0.750000,1.000000,
    0.250000,0.250000,1.000000,
    0.250000,0.250000,0.750000,
    0.750000,0.750000,1.000000,
    0.250000,0.750000,1.000000,
    0.250000,0.750000,0.750000,
    0.750000,0.250000,1.000000,
    0.750000,0.750000,1.000000,
    0.750000,0.750000,0.750000]},{"edges":[0,0,1,0,1,0],"rot":1,"triangles":[0.250000,1.000000,0.250000,
    0.250000,0.000000,0.750000,
    0.250000,0.000000,0.250000,
    0.250000,1.000000,0.750000,
    0.750000,0.000000,0.750000,
    0.250000,0.000000,0.750000,
    0.750000,1.000000,0.750000,
    0.750000,0.000000,0.250000,
    0.750000,0.000000,0.750000,
    0.750000,1.000000,0.250000,
    0.250000,0.000000,0.250000,
    0.750000,0.000000,0.250000,
    0.250000,1.000000,0.750000,
    0.750000,1.000000,0.750000,
    0.750000,0.000000,0.750000,
    0.250000,1.000000,0.250000,
    0.250000,1.000000,0.750000,
    0.250000,0.000000,0.750000,
    0.750000,1.000000,0.750000,
    0.750000,1.000000,0.250000,
    0.750000,0.000000,0.250000,
    0.750000,1.000000,0.250000,
    0.250000,1.000000,0.250000,
    0.250000,0.000000,0.250000]},{"edges":[0,1,1,0,0,0],"rot":1,"triangles":[0.250000,0.750000,0.750000,
    0.250000,0.250000,0.250000,
    0.250000,0.750000,0.250000,
    0.750000,0.250000,0.750000,
    0.750000,0.750000,0.250000,
    0.750000,0.250000,0.250000,
    0.750000,0.750000,0.750000,
    0.250000,0.750000,0.250000,
    0.750000,0.750000,0.250000,
    0.250000,0.250000,0.750000,
    0.750000,0.750000,0.750000,
    0.750000,0.250000,0.750000,
    0.250000,0.000000,0.750000,
    0.250000,0.250000,0.250000,
    0.250000,0.250000,0.750000,
    0.750000,0.000000,0.750000,
    0.250000,0.250000,0.750000,
    0.750000,0.250000,0.750000,
    0.750000,0.000000,0.250000,
    0.750000,0.250000,0.750000,
    0.750000,0.250000,0.250000,
    0.250000,0.000000,0.250000,
    0.750000,0.250000,0.250000,
    0.250000,0.250000,0.250000,
    0.750000,0.250000,0.000000,
    0.250000,0.250000,0.250000,
    0.750000,0.250000,0.250000,
    0.750000,0.750000,0.000000,
    0.750000,0.250000,0.250000,
    0.750000,0.750000,0.250000,
    0.250000,0.750000,0.000000,
    0.750000,0.750000,0.250000,
    0.250000,0.750000,0.250000,
    0.250000,0.250000,0.000000,
    0.250000,0.750000,0.250000,
    0.250000,0.250000,0.250000,
    0.250000,0.750000,0.750000,
    0.250000,0.250000,0.750000,
    0.250000,0.250000,0.250000,
    0.750000,0.250000,0.750000,
    0.750000,0.750000,0.750000,
    0.750000,0.750000,0.250000,
    0.750000,0.750000,0.750000,
    0.250000,0.750000,0.750000,
    0.250000,0.750000,0.250000,
    0.250000,0.250000,0.750000,
    0.250000,0.750000,0.750000,
    0.750000,0.750000,0.750000,
    0.250000,0.000000,0.750000,
    0.250000,0.000000,0.250000,
    0.250000,0.250000,0.250000,
    0.750000,0.000000,0.750000,
    0.250000,0.000000,0.750000,
    0.250000,0.250000,0.750000,
    0.750000,0.000000,0.250000,
    0.750000,0.000000,0.750000,
    0.750000,0.250000,0.750000,
    0.250000,0.000000,0.250000,
    0.750000,0.000000,0.250000,
    0.750000,0.250000,0.250000,
    0.750000,0.250000,0.000000,
    0.250000,0.250000,0.000000,
    0.250000,0.250000,0.250000,
    0.750000,0.750000,0.000000,
    0.750000,0.250000,0.000000,
    0.750000,0.250000,0.250000,
    0.250000,0.750000,0.000000,
    0.750000,0.750000,0.000000,
    0.750000,0.750000,0.250000,
    0.250000,0.250000,0.000000,
    0.250000,0.750000,0.000000,
    0.250000,0.750000,0.250000]},{"edges":[1,0,1,0,0,0],"rot":1,"triangles":[0.250000,0.750000,0.750000,
    0.250000,0.250000,0.250000,
    0.250000,0.750000,0.250000,
    0.750000,0.250000,0.750000,
    0.750000,0.750000,0.250000,
    0.750000,0.250000,0.250000,
    0.750000,0.750000,0.750000,
    0.250000,0.750000,0.250000,
    0.750000,0.750000,0.250000,
    0.750000,0.750000,0.750000,
    0.250000,0.750000,1.000000,
    0.250000,0.750000,0.750000,
    0.250000,0.000000,0.750000,
    0.250000,0.250000,0.250000,
    0.250000,0.250000,0.750000,
    0.750000,0.250000,0.750000,
    0.250000,0.000000,0.750000,
    0.250000,0.250000,0.750000,
    0.750000,0.000000,0.250000,
    0.750000,0.250000,0.750000,
    0.750000,0.250000,0.250000,
    0.250000,0.000000,0.250000,
    0.750000,0.250000,0.250000,
    0.250000,0.250000,0.250000,
    0.750000,0.250000,0.250000,
    0.250000,0.750000,0.250000,
    0.250000,0.250000,0.250000,
    0.250000,0.250000,0.750000,
    0.750000,0.250000,1.000000,
    0.750000,0.250000,0.750000,
    0.750000,0.250000,0.750000,
    0.750000,0.750000,1.000000,
    0.750000,0.750000,0.750000,
    0.250000,0.750000,0.750000,
    0.250000,0.250000,1.000000,
    0.250000,0.250000,0.750000,
    0.250000,0.750000,0.750000,
    0.250000,0.250000,0.750000,
    0.250000,0.250000,0.250000,
    0.750000,0.250000,0.750000,
    0.750000,0.750000,0.750000,
    0.750000,0.750000,0.250000,
    0.750000,0.750000,0.750000,
    0.250000,0.750000,0.750000,
    0.250000,0.750000,0.250000,
    0.750000,0.750000,0.750000,
    0.750000,0.750000,1.000000,
    0.250000,0.750000,1.000000,
    0.250000,0.000000,0.750000,
    0.250000,0.000000,0.250000,
    0.250000,0.250000,0.250000,
    0.750000,0.250000,0.750000,
    0.750000,0.000000,0.750000,
    0.250000,0.000000,0.750000,
    0.750000,0.000000,0.250000,
    0.750000,0.000000,0.750000,
    0.750000,0.250000,0.750000,
    0.250000,0.000000,0.250000,
    0.750000,0.000000,0.250000,
    0.750000,0.250000,0.250000,
    0.750000,0.250000,0.250000,
    0.750000,0.750000,0.250000,
    0.250000,0.750000,0.250000,
    0.250000,0.250000,0.750000,
    0.250000,0.250000,1.000000,
    0.750000,0.250000,1.000000,
    0.750000,0.250000,0.750000,
    0.750000,0.250000,1.000000,
    0.750000,0.750000,1.000000,
    0.250000,0.750000,0.750000,
    0.250000,0.750000,1.000000,
    0.250000,0.250000,1.000000]},{"edges":[0,1,0,1,0,1],"rot":1,"triangles":[0.000000,0.250000,0.250000,
    0.000000,0.250000,0.750000,
    0.250000,0.250000,0.750000,
    0.250000,0.250000,0.750000,
    0.750000,0.250000,0.250000,
    0.250000,0.250000,0.250000,
    0.000000,0.250000,0.750000,
    0.000000,0.750000,0.750000,
    0.250000,0.750000,0.750000,
    0.750000,0.750000,0.750000,
    0.250000,0.750000,0.250000,
    0.750000,0.750000,0.250000,
    0.000000,0.750000,0.750000,
    0.000000,0.750000,0.250000,
    0.250000,0.750000,0.250000,
    0.250000,0.250000,0.750000,
    0.750000,0.750000,0.750000,
    0.750000,0.250000,0.750000,
    0.250000,0.250000,0.750000,
    0.250000,0.750000,0.750000,
    0.750000,0.750000,0.750000,
    0.000000,0.750000,0.750000,
    0.250000,0.750000,0.250000,
    0.250000,0.750000,0.750000,
    0.000000,0.250000,0.750000,
    0.250000,0.750000,0.750000,
    0.250000,0.250000,0.750000,
    0.000000,0.250000,0.250000,
    0.250000,0.250000,0.750000,
    0.250000,0.250000,0.250000,
    0.000000,0.750000,0.250000,
    0.250000,0.250000,0.250000,
    0.250000,0.750000,0.250000,
    0.750000,0.750000,0.750000,
    0.250000,0.750000,0.750000,
    0.250000,0.750000,0.250000,
    1.000000,0.250000,0.750000,
    0.750000,0.250000,0.250000,
    0.750000,0.250000,0.750000,
    1.000000,0.750000,0.750000,
    0.750000,0.250000,0.750000,
    0.750000,0.750000,0.750000,
    1.000000,0.750000,0.250000,
    0.750000,0.750000,0.750000,
    0.750000,0.750000,0.250000,
    1.000000,0.250000,0.250000,
    0.750000,0.750000,0.250000,
    0.750000,0.250000,0.250000,
    0.250000,0.250000,0.750000,
    0.750000,0.250000,0.750000,
    0.750000,0.250000,0.250000,
    0.750000,0.250000,0.000000,
    0.250000,0.250000,0.250000,
    0.750000,0.250000,0.250000,
    0.750000,0.750000,0.000000,
    0.750000,0.250000,0.250000,
    0.750000,0.750000,0.250000,
    0.250000,0.750000,0.000000,
    0.750000,0.750000,0.250000,
    0.250000,0.750000,0.250000,
    0.250000,0.250000,0.000000,
    0.250000,0.750000,0.250000,
    0.250000,0.250000,0.250000,
    0.000000,0.750000,0.250000,
    0.000000,0.250000,0.250000,
    0.250000,0.250000,0.250000,
    1.000000,0.250000,0.750000,
    1.000000,0.250000,0.250000,
    0.750000,0.250000,0.250000,
    1.000000,0.750000,0.750000,
    1.000000,0.250000,0.750000,
    0.750000,0.250000,0.750000,
    1.000000,0.750000,0.250000,
    1.000000,0.750000,0.750000,
    0.750000,0.750000,0.750000,
    1.000000,0.250000,0.250000,
    1.000000,0.750000,0.250000,
    0.750000,0.750000,0.250000,
    0.750000,0.250000,0.000000,
    0.250000,0.250000,0.000000,
    0.250000,0.250000,0.250000,
    0.750000,0.750000,0.000000,
    0.750000,0.250000,0.000000,
    0.750000,0.250000,0.250000,
    0.250000,0.750000,0.000000,
    0.750000,0.750000,0.000000,
    0.750000,0.750000,0.250000,
    0.250000,0.250000,0.000000,
    0.250000,0.750000,0.000000,
    0.250000,0.750000,0.250000]},{"edges":[1,0,0,1,0,1],"rot":1,"triangles":[0.000000,0.250000,0.750000,
    0.250000,0.250000,0.250000,
    0.000000,0.250000,0.250000,
    0.250000,0.250000,0.250000,
    0.250000,0.250000,0.750000,
    0.750000,0.250000,0.750000,
    0.000000,0.250000,0.250000,
    0.250000,0.750000,0.250000,
    0.000000,0.750000,0.250000,
    0.750000,0.750000,0.250000,
    0.750000,0.750000,0.750000,
    0.250000,0.750000,0.750000,
    0.000000,0.750000,0.250000,
    0.250000,0.750000,0.750000,
    0.000000,0.750000,0.750000,
    0.250000,0.250000,0.250000,
    0.750000,0.250000,0.250000,
    0.750000,0.750000,0.250000,
    0.250000,0.250000,0.250000,
    0.750000,0.750000,0.250000,
    0.250000,0.750000,0.250000,
    0.000000,0.750000,0.250000,
    0.250000,0.750000,0.250000,
    0.250000,0.750000,0.750000,
    0.000000,0.250000,0.250000,
    0.250000,0.250000,0.250000,
    0.250000,0.750000,0.250000,
    0.000000,0.250000,0.750000,
    0.250000,0.250000,0.750000,
    0.250000,0.250000,0.250000,
    0.000000,0.750000,0.750000,
    0.250000,0.750000,0.750000,
    0.250000,0.250000,0.750000,
    0.750000,0.750000,0.250000,
    0.250000,0.750000,0.750000,
    0.250000,0.750000,0.250000,
    1.000000,0.250000,0.250000,
    0.750000,0.250000,0.250000,
    0.750000,0.250000,0.750000,
    1.000000,0.750000,0.250000,
    0.750000,0.750000,0.250000,
    0.750000,0.250000,0.250000,
    1.000000,0.750000,0.750000,
    0.750000,0.750000,0.750000,
    0.750000,0.750000,0.250000,
    1.000000,0.250000,0.750000,
    0.750000,0.250000,0.750000,
    0.750000,0.750000,0.750000,
    0.250000,0.250000,0.250000,
    0.750000,0.250000,0.750000,
    0.750000,0.250000,0.250000,
    0.750000,0.250000,1.000000,
    0.750000,0.250000,0.750000,
    0.250000,0.250000,0.750000,
    0.750000,0.750000,1.000000,
    0.750000,0.750000,0.750000,
    0.750000,0.250000,0.750000,
    0.250000,0.750000,1.000000,
    0.250000,0.750000,0.750000,
    0.750000,0.750000,0.750000,
    0.250000,0.250000,1.000000,
    0.250000,0.250000,0.750000,
    0.250000,0.750000,0.750000,
    0.000000,0.750000,0.750000,
    0.250000,0.250000,0.750000,
    0.000000,0.250000,0.750000,
    1.000000,0.250000,0.250000,
    0.750000,0.250000,0.750000,
    1.000000,0.250000,0.750000,
    1.000000,0.750000,0.250000,
    0.750000,0.250000,0.250000,
    1.000000,0.250000,0.250000,
    1.000000,0.750000,0.750000,
    0.750000,0.750000,0.250000,
    1.000000,0.750000,0.250000,
    1.000000,0.250000,0.750000,
    0.750000,0.750000,0.750000,
    1.000000,0.750000,0.750000,
    0.750000,0.250000,1.000000,
    0.250000,0.250000,0.750000,
    0.250000,0.250000,1.000000,
    0.750000,0.750000,1.000000,
    0.750000,0.250000,0.750000,
    0.750000,0.250000,1.000000,
    0.250000,0.750000,1.000000,
    0.750000,0.750000,0.750000,
    0.750000,0.750000,1.000000,
    0.250000,0.250000,1.000000,
    0.250000,0.750000,0.750000,
    0.250000,0.750000,1.000000]},{"edges":[0,0,0,1,1,1],"rot":1,"triangles":[0.000000,0.750000,0.750000,
    0.250000,0.250000,0.750000,
    0.000000,0.250000,0.750000,
    0.250000,0.250000,0.750000,
    0.250000,0.750000,0.750000,
    0.750000,0.750000,0.750000,
    0.000000,0.250000,0.750000,
    0.250000,0.250000,0.250000,
    0.000000,0.250000,0.250000,
    0.750000,0.250000,0.250000,
    0.750000,0.750000,0.250000,
    0.250000,0.750000,0.250000,
    0.000000,0.250000,0.250000,
    0.250000,0.750000,0.250000,
    0.000000,0.750000,0.250000,
    0.250000,0.250000,0.750000,
    0.750000,0.250000,0.750000,
    0.750000,0.250000,0.250000,
    0.250000,0.250000,0.750000,
    0.750000,0.250000,0.250000,
    0.250000,0.250000,0.250000,
    0.000000,0.250000,0.250000,
    0.250000,0.250000,0.250000,
    0.250000,0.750000,0.250000,
    0.000000,0.250000,0.750000,
    0.250000,0.250000,0.750000,
    0.250000,0.250000,0.250000,
    0.000000,0.750000,0.750000,
    0.250000,0.750000,0.750000,
    0.250000,0.250000,0.750000,
    0.000000,0.750000,0.250000,
    0.250000,0.750000,0.250000,
    0.250000,0.750000,0.750000,
    0.750000,0.250000,0.250000,
    0.250000,0.750000,0.250000,
    0.250000,0.250000,0.250000,
    1.000000,0.250000,0.750000,
    0.750000,0.250000,0.750000,
    0.750000,0.750000,0.750000,
    1.000000,0.250000,0.250000,
    0.750000,0.250000,0.250000,
    0.750000,0.250000,0.750000,
    1.000000,0.750000,0.250000,
    0.750000,0.750000,0.250000,
    0.750000,0.250000,0.250000,
    1.000000,0.750000,0.750000,
    0.750000,0.750000,0.750000,
    0.750000,0.750000,0.250000,
    0.250000,0.250000,0.750000,
    0.750000,0.750000,0.750000,
    0.750000,0.250000,0.750000,
    0.750000,1.000000,0.750000,
    0.750000,0.750000,0.750000,
    0.250000,0.750000,0.750000,
    0.750000,1.000000,0.250000,
    0.750000,0.750000,0.250000,
    0.750000,0.750000,0.750000,
    0.250000,1.000000,0.250000,
    0.250000,0.750000,0.250000,
    0.750000,0.750000,0.250000,
    0.250000,1.000000,0.750000,
    0.250000,0.750000,0.750000,
    0.250000,0.750000,0.250000,
    0.000000,0.750000,0.250000,
    0.250000,0.750000,0.750000,
    0.000000,0.750000,0.750000,
    1.000000,0.250000,0.750000,
    0.750000,0.750000,0.750000,
    1.000000,0.750000,0.750000,
    1.000000,0.250000,0.250000,
    0.750000,0.250000,0.750000,
    1.000000,0.250000,0.750000,
    1.000000,0.750000,0.250000,
    0.750000,0.250000,0.250000,
    1.000000,0.250000,0.250000,
    1.000000,0.750000,0.750000,
    0.750000,0.750000,0.250000,
    1.000000,0.750000,0.250000,
    0.750000,1.000000,0.750000,
    0.250000,0.750000,0.750000,
    0.250000,1.000000,0.750000,
    0.750000,1.000000,0.250000,
    0.750000,0.750000,0.750000,
    0.750000,1.000000,0.750000,
    0.250000,1.000000,0.250000,
    0.750000,0.750000,0.250000,
    0.750000,1.000000,0.250000,
    0.250000,1.000000,0.750000,
    0.250000,0.750000,0.250000,
    0.250000,1.000000,0.250000]}]}
`;

//helper for integer arrays
function arrContains(arr, val) {
    for (var x = 0; x < arr.length; x++)
    {
        if (arr[x] === val) {
            return true;
        }
    }
    
    return false;
}

function setVal(arr, x, y, z, val, bounds) {
    arr[x + y * bounds.x + z * bounds.x * bounds.y] = val;
}

function generateTileBuffer() {
    let text = tilesText;
    var data = JSON.parse(text);

    let arr = data.tiles;

    let triPointer = 0;

    let meshpointers = [];
    let triangles = [];

    let tiles = [];

    let allEdgeTypes = [];

    for(var x = 0; x < arr.length; x++) {
        meshpointers[meshpointers.length] = triPointer;

        for(var y = 0; y < arr[x].triangles.length; y += 3) {
            triangles[triangles.length] = arr[x].triangles[y];
            triangles[triangles.length] = arr[x].triangles[y + 1];
            triangles[triangles.length] = arr[x].triangles[y + 2];
            triangles[triangles.length] = 0.;
            triPointer++;
        }

        for (var y = 0; y < 6; y++) {
            let type = arr[x].edges[y];
            if (!arrContains(allEdgeTypes, type)) {
                allEdgeTypes.push(type);
            }
        }

        switch(arr[x].rot) {
            case 0:
                tiles[tiles.length] = {
                    edges : arr[x].edges,
                    edges_req : [0, 0, 0, 0, 0, 0],
                    mesh : meshpointers.length - 1,
                    rotation : 0
                };
                break;
            case 1:
                e = arr[x].edges;
                for (var i = 0; i < 4; i++) {
                    tiles[tiles.length] = {
                        edges : [e[0], e[1], e[2 + (-i + 4) % 4], e[2 + (-i + 5) %4], e[2 + (-i + 6) % 4], e[2 + (-i + 7) % 4]],
                        edges_req : [0, 0, 0, 0, 0, 0], //change this later!!
                        mesh : meshpointers.length - 1,
                        rotation : i
                    };
                }
                break;
            default:
                console.log("neither");
        }
    }

    GLOBAL.wfc.tiles = tiles;

    meshpointers[meshpointers.length] = triPointer;

    GLOBAL.wfc.meshes.pointers = meshpointers;
    GLOBAL.wfc.meshes.triangles = triangles;
    GLOBAL.wfc.params.allEdgeTypes = allEdgeTypes;
}