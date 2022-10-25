let gpu;

let thetas = {x: -0.2, y: 3.1415/4. - .2};

let forward = {x: 0, y: 0, z: 0};
let right = {x: 0, y: 0, z: 0};
let position = {x: 0, y: 0, z: 0};
let mouse = {active: false, position: {}};
let speed = 5.;
let dist = 500.;
let sensitivity = .2;

window.onload = async () => {
    gpu = await voxels({
        canvas: document.querySelector("#render")
    });

    document.addEventListener('keypress', (e) => {
        //ignore input if not above a canvas
        if (!overCanvas()) {
            return;
        }

        //handle different inputs
        switch (e.code) {
            case "KeyW":
                dist -= 10.;
                break;
            case "KeyS":
                dist += 10.;
                break;
        }
    });

    //mouse - rotation (click to enable)
    document.addEventListener('mousemove', (e) => {
        //do actions if currently rotating
        if (mouse.active) {
            const deltaX = e.pageX - mouse.position.x;
            const deltaY = -e.pageY + mouse.position.y;

            //change rotation
            thetas.x = thetas.x + deltaX * sensitivity * Math.PI / 180.;
            thetas.y = thetas.y + deltaY * sensitivity * Math.PI / 180.;

            //clamp rotation
            thetas.y = Math.min(Math.max(thetas.y, -Math.PI / 2), Math.PI / 2);
            
            //reset sample accumulation
            reset = true;

            setfandr();
        }

        //store mouse position
        mouse.position.x = e.pageX;
        mouse.position.y = e.pageY;
    });

    //click changes if mouse is active
    document.addEventListener('mousedown', (e) => {
        if (!overCanvas() && mouse.active == false) {
            return;
        }

        //prevent usual behavior
        e.preventDefault();

        //flip active or not
        mouse.active = !mouse.active;

        //hide cursor when active
        if (mouse.active == true) {
            //reset sample accumulation
            reset = true;

            document.body.style.cursor = "none";
        } else { //reset cursor to visible
            document.body.style.cursor = "auto";
        }
    });

    setfandr();

    frame();
};


function frame() {
    gpu.setForward(forward);
    gpu.setRight(right);
    position = {x: 128, y: 128, z: 128};
    addVec(position, multiplyVec(forward, -dist));
    gpu.setPosition(position);
    gpu.frame();

    window.requestAnimationFrame(frame);
}

function overCanvas() {
    let elementAbove = document.elementFromPoint(
        mouse.position.x, 
        mouse.position.y
    );
    
    return elementAbove.id === "render";
}


function setfandr() {
    thetas.x *= -1.;
    thetas.y *= -1.;
    forward = {
        x: Math.cos(thetas.x) * Math.cos(thetas.y),
        y: Math.sin(thetas.x) * Math.cos(thetas.y),
        z: Math.sin(thetas.y)
    };

    const ninety = Math.PI / 2.;

    right = {
        x: Math.cos(thetas.x + ninety),
        y: Math.sin(thetas.x + ninety),
        z: 0
    };

    thetas.x *= -1.;
    thetas.y *= -1.;
}

//helper
function addVec(u, v) {
    u.x += v.x;
    u.y += v.y;
    u.z += v.z;
}

//helper - does not modify actual vector
function multiplyVec(u, k) {
    return {
        x: u.x * k,
        y: u.y * k,
        z: u.z * k
    };
}

//move position forward
function moveForward(dist) {
    addVec(position, multiplyVec(forward, dist));
}

//move position backward
function moveBackward(dist) {
    moveForward(-dist);
}

//move position right
function moveRight(dist) {
    addVec(position, multiplyVec(right, dist));
}

//move position left
function moveLeft(dist) {
    moveRight(-dist);
}
