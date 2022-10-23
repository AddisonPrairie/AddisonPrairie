//handles cursor/keyboard input, seperate from gui
class Input {

    //store position and direction in vals
    vals;
    canvas;

    //stores locally tracked things - mouse position etc.
    locals = {mouse: {active: false, position: {}}};

    //constructor
    constructor(vals, canvas) {
        //set members
        this.vals = vals;
        this.canvas = canvas;
        //set bindings (only function that should be called)
        this.initBindings();
        this.setForwardAndRight();
        console.log("Hello from input");
    }

    //initialize event bindings
    initBindings() {
        //Handle key controls:
        //w - forward
        //s - backward
        //a - left
        //d - right
        //? more
        document.addEventListener('keypress', (e) => {
            //ignore input if not above a canvas
            if (!this.overCanvas()) {
                return;
            }

            if (this.vals.pause === true) {
                return;
            }
            return; //CHANGE THIS
            //handle different inputs
            switch (e.code) {
                case "KeyW":
                    //reset sample accumulation
                    this.vals.reset = true;
                    this.moveForward(this.vals.speed);
                    break;
                case "KeyA":
                    //reset sample accumulation
                    this.vals.reset = true;
                    this.moveLeft(this.vals.speed);
                    break;
                case "KeyS":
                    //reset sample accumulation
                    this.vals.reset = true;
                    this.moveBackward(this.vals.speed);
                    break;
                case "KeyD":
                    //reset sample accumulation
                    this.vals.reset = true;
                    this.moveRight(this.vals.speed);
                    break;
            }
        });

        //mouse - rotation (click to enable)
        document.addEventListener('mousemove', (e) => {
            if (this.vals.pause === true) {
                return;
            }

            //do actions if currently rotating
            if (this.locals.mouse.active) {
                const deltaX = e.pageX - this.locals.mouse.position.x;
                const deltaY = -e.pageY + this.locals.mouse.position.y;

                //change rotation
                this.vals.theta1 = this.vals.theta1 + deltaX * this.vals.sensitivity * Math.PI / 180.;
                this.vals.theta2 = this.vals.theta2 + deltaY * this.vals.sensitivity * Math.PI / 180.;

                //clamp rotation
                this.vals.theta2 = Math.min(Math.max(this.vals.theta2, -Math.PI / 2), Math.PI / 2);
                
                //reset sample accumulation
                this.vals.reset = true;

                this.setForwardAndRight();

                this.setPosition();
            }

            //store mouse position
            this.locals.mouse.position.x = e.pageX;
            this.locals.mouse.position.y = e.pageY;

            this.vals.mouseX = e.pageX;
            this.vals.mouseY = e.pageY;
        });

        //click changes if mouse is active
        document.addEventListener('mousedown', (e) => {
            if (!this.overCanvas() && this.locals.mouse.active == false) {
                return;
            }

            //prevent usual behavior
            e.preventDefault();

            //hide cursor when active
            if (this.locals.mouse.active == false) {
                if (this.vals.pause === true) {
                    
                    return;
                }
                this.locals.mouse.active = true;
                //reset sample accumulation
                this.vals.reset = true;

                document.body.style.cursor = "none";
            } else { //reset cursor to visible
                this.locals.mouse.active = false;
                document.body.style.cursor = "auto";
            }
        });

        this.vals.flipState = (e) => {
            if (!this.overCanvas() && this.locals.mouse.active == false) {
                return;
            }

            //prevent usual behavior
            e.preventDefault();

            //hide cursor when active
            if (this.locals.mouse.active == false) {
                if (this.vals.rotateIgnore == true) {
                    return;
                }
                if (this.vals.pause === true) {
                    return;
                }
                this.locals.mouse.active = true;
                //reset sample accumulation
                this.vals.reset = true;

                document.body.style.cursor = "none";
            } else { //reset cursor to visible
                this.locals.mouse.active = false;
                document.body.style.cursor = "auto";
            }
        };
    }

    //helper - return if mouse is over canvas
    overCanvas() {
        let elementAbove = document.elementFromPoint(
            this.locals.mouse.position.x, 
            this.locals.mouse.position.y
        );
        
        return elementAbove.id === "canvas";
    }

    //helper
    degToRad() {
        return Math.PI * theta / 180.;
    }

    setPosition() {
        this.vals.position = {
            x: this.vals.posCenterPoint.x - this.vals.distance * this.vals.forward.x,
            y: this.vals.posCenterPoint.y - this.vals.distance * this.vals.forward.y,
            z: this.vals.posCenterPoint.z - this.vals.distance * this.vals.forward.z,
        };       
    }

    //set uniforms/external value of direction vectors - forward and right
    setForwardAndRight() {
        //angles
        let t1 = -this.vals.theta1;
        let t2 = -this.vals.theta2;
        const ninety = Math.PI / 2.;

        //forward
        this.vals.forward = {
            x: Math.cos(t1) * Math.cos(t2),
            y: Math.sin(t1) * Math.cos(t2),
            z: Math.sin(t2)
        };
        const b = this.vals.forward;

        //right
        this.vals.right = {
            x: Math.cos(t1 + ninety),
            y: Math.sin(t1 + ninety),
            z: 0
        }
    }

    //helper
    addVec(u, v) {
        u.x += v.x;
        u.y += v.y;
        u.z += v.z;
    }

    //helper - does not modify actual vector
    multiplyVec(u, k) {
        return {
            x: u.x * k,
            y: u.y * k,
            z: u.z * k
        };
    }

    //move position forward
    moveForward(dist) {
        this.addVec(this.vals.position, this.multiplyVec(this.vals.forward, dist));
    }

    //move position backward
    moveBackward(dist) {
        this.moveForward(-dist);
    }

    //move position right
    moveRight(dist) {
        this.addVec(this.vals.position, this.multiplyVec(this.vals.right, dist));
    }

    //move position left
    moveLeft(dist) {
        this.moveRight(-dist);
    }
}