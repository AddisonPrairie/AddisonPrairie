//voxel API

async function voxels(opt) {

    //user must supply a canvas to render to
    if (!("canvas" in opt) || !(opt["canvas"] instanceof HTMLCanvasElement)) {
        console.error("voxel error: no canvas");
        return;
    }

    let canvas = opt.canvas;

    resizeCanvasToDisplaySize(canvas);

    let width = canvas.width;
    let height = canvas.height;

    //gl variables
    let gl = canvas.getContext("webgl2");
    let attributeLocations = {};

    //rendering to float textures
    if (!gl.getExtension("EXT_color_buffer_float")) {
        console.error("FLOAT color buffer not available");
        return;
    }

    //reserved textures
    //TEXTURE0 - state
    //TEXTURE1 - bluenoise
    //TEXTURE2 - raw result 1
    //TEXTURE3 - position 1
    //TEXTURE4 - samples 1
    //TEXTURE5 - raw result 2
    //TEXTURE6 - raw position 2
    //TEXTURE7 - samples 2
    //TEXTURE8 - atrous 1
    //TEXTURE9 - atrous 2
    //TEXTURE10 - raw color (albedo)

    //variables for voxel states
    let statesTexture = gl.createTexture();

    //pipeline variables
    //raw & reprojection -> atrous x5 -> FXAA
    const rawProgram = createProgramFromScripts(gl, await fetch("shaders/quad.vs").then(result => result.text()), await fetch("shaders/raw.fs").then(result => result.text()));
    let rawDiffuseTexture1 = null;
    let rawPositionTexture1 = null;
    let samplesTexture1 = null;
    let rawDiffuseTexture2 = null;
    let rawPositionTexture2 = null;
    let samplesTexture2 = null;
    let albedoTexture = null;
    const rawFrameBuffer1 = gl.createFramebuffer();
    const rawFrameBuffer2 = gl.createFramebuffer();
    const denoiseProgram = createProgramFromScripts(gl, await fetch("shaders/quad.vs").then(result => result.text()), await fetch("shaders/denoise.fs").then(result => result.text()));
    let atrousTexture1 = null;
    let atrousTexture2 = null;
    const atrousFrameBuffer1 = gl.createFramebuffer();
    const atrousFrameBuffer2 = gl.createFramebuffer();
    const atrousFinalBuffer = gl.createFramebuffer();
    const fxaaProgram = createProgramFromScripts(gl, await fetch("shaders/quad.vs").then(result => result.text()), await fetch("shaders/fxaa.fs").then(result => result.text()));
    let fxaaTexture = null;

    //uniform variables
    let forward = {x: 0, y: 1, z: 0};
    let right = {x: 1, y: 0, z: 0};
    let position = {x: 0, y: 0, z: 0};
    let lastForward = {x: 0, y: 1, z: 0};
    let lastRight = {x: 1, y: 0, z: 0};
    let lastPosition = {x: 0, y: 0, z: 0};
    let frames = 0;

    //load noise
    let img = new Image();
    img.src = "/static/bluenoise16.png";
    img.onload = () => {
        let tex = gl.createTexture();
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR);

        let canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 128 * 16;
        let ctx = canvas.getContext('2d');
        
        ctx.drawImage(img, 0, 0);
        var imgData = ctx.getImageData(0, 0, 128, 128 * 16);
        var pixels = new Uint8Array(imgData.data.buffer);

        gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.RGBA, 128, 128, 16, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    };

    {//get attribute locations in all shaders - used for uniforms
        attributeLocations = {//naming should be program_name
            "raw_screensize": gl.getUniformLocation(rawProgram, "u_screensize"),
            "raw_forward": gl.getUniformLocation(rawProgram, "u_forward"),
            "raw_right": gl.getUniformLocation(rawProgram, "u_right"),
            "raw_position": gl.getUniformLocation(rawProgram, "u_position"),
            "raw_states": gl.getUniformLocation(rawProgram, "u_states"),
            "raw_bluenoise": gl.getUniformLocation(rawProgram, "u_bluenoise"),
            "raw_frames": gl.getUniformLocation(rawProgram, "u_frames"),
            "raw_reproject": gl.getUniformLocation(rawProgram, "u_reproject"),
            "raw_lForward": gl.getUniformLocation(rawProgram, "u_lForward"),
            "raw_lRight": gl.getUniformLocation(rawProgram, "u_lRight"),
            "raw_lPosition": gl.getUniformLocation(rawProgram, "u_lPosition"),
            "raw_lColor": gl.getUniformLocation(rawProgram, "u_lColor"),
            "raw_lWorldPosition": gl.getUniformLocation(rawProgram, "u_lWorldPosition"),
            "raw_samples": gl.getUniformLocation(rawProgram, "u_samples"),
            "denoise_offset": gl.getUniformLocation(denoiseProgram, "u_offset"),
            "denoise_color1": gl.getUniformLocation(denoiseProgram, "u_color1"),
            "denoise_position1": gl.getUniformLocation(denoiseProgram, "u_position1"),
            "denoise_screensize": gl.getUniformLocation(denoiseProgram, "u_screensize"),
            "denoise_samples1": gl.getUniformLocation(denoiseProgram, "u_samples1"),
            "denoise_albedo": gl.getUniformLocation(denoiseProgram, "u_albedo"),
            "denoise_last": gl.getUniformLocation(denoiseProgram, "u_last"),
            "denoise_steps": gl.getUniformLocation(denoiseProgram, "u_step"),
            "fxaa_color": gl.getUniformLocation(fxaaProgram, "u_color"),
            "fxaa_position": gl.getUniformLocation(fxaaProgram, "u_position"),
            "fxaa_screensize": gl.getUniformLocation(fxaaProgram, "u_screensize")
        };
    }

    {//set one time uniforms like texture pointers
        gl.useProgram(rawProgram);
        gl.uniform1i(attributeLocations.raw_states, 0);
        gl.uniform1i(attributeLocations.raw_bluenoise, 1);

        gl.useProgram(denoiseProgram);
        gl.uniform1i(attributeLocations.denoise_albedo, 10);
    }

    //inefficient and lazy conversion from raw state array to dense "octree"
    let lazyConvert = (raw) => {
        var offsets = [0, 8, 72, 584, 4680, 37448, 299592, 2396744];
        var offset;
        var loffset;

        var d = 256;
        var d2 = 256 * 256;
        var ld = 1;
        var ld2 = 1;

        var returned = new Uint8Array(19173960);

        for (var level = 7; level >= 0; level--) {
            offset = offsets[level];
            for (var x = 0; x < d; x++) {
                for (var y = 0; y < d; y++) {
                    for (var z = 0; z < d; z++) {
                        if (level == 7) {
                            setPre(returned, offset, d2, d, x, y, z, raw[x][y][z] > 0 ? 2 : 0);
                        } else {
                            var allfull = true;
                            var allempty = true;
                            var x2 = 2 * x;
                            var y2 = 2 * y;
                            var z2 = 2 * z;
                            for (var i = 0; i < 2; i++) {
                                for (var j = 0; j < 2; j++) {
                                   for (var k = 0; k < 2; k++) {
                                    var fetched = fetchPre(returned, loffset, ld2, ld, x2 + i, y2 + j, z2 + k);
                                    if (fetched > 0) {
                                        allempty = false;
                                    }
                                    if (fetched < 2) {
                                        allfull = false;
                                    }
                                   }
                                }
                            }
                            if (allempty) {
                                setPre(returned, offset, d2, d, x, y, z, 0);
                            } else if (allfull) {
                                setPre(returned, offset, d2, d, x, y, z, 2);
                            } else {
                                setPre(returned, offset, d2, d, x, y, z, 1);
                            }
                        }
                    }
                }
            }
            ld = d;
            ld2 = d2;
            loffset = offset;
            d = d / 2;
            d2 = d2 / 4;
        }

        return returned;
    };

    //loads the states texture
    //NOTE: data must array of 8UI
    let loadStates = (data) => {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, statesTexture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8UI, 4680, 4097, 0, gl.RED_INTEGER, gl.UNSIGNED_BYTE, data);
    };

    //loadStates(lazyConvert(JSON.parse(await fetch("model.txt").then(response => response.text()))));

    //when the screen is resized (or on start), recreate the textures/renderbuffers
    let onResize = () => {
        if (rawDiffuseTexture1 != null) {
            gl.deleteTexture(rawDiffuseTexture1);
        }
        if (rawPositionTexture1 != null) {
            gl.deleteTexture(rawPositionTexture1);
        }
        if (rawDiffuseTexture2 != null) {
            gl.deleteTexture(rawDiffuseTexture2);
        }
        if (rawPositionTexture2 != null) {
            gl.deleteTexture(rawPositionTexture2);
        }
        if (samplesTexture1 != null) {
            gl.deleteTexture(samplesTexture1);
        }
        if (samplesTexture2 != null) {
            gl.deleteTexture(samplesTexture2);
        }
        if (atrousTexture1 != null) {
            gl.deleteTexture(atrousTexture1);
        }
        if(atrousTexture2 != null) {
            gl.deleteTexture(atrousTexture2);
        }
        if (albedoTexture != null) {
            gl.deleteTexture(albedoTexture);
        }
        if (fxaaTexture != null) {
            gl.deleteTexture(fxaaTexture);
        }

        rawDiffuseTexture1 = gl.createTexture();
        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, rawDiffuseTexture1);
        gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, width, height);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

        rawPositionTexture1 = gl.createTexture();
        gl.activeTexture(gl.TEXTURE3);
        gl.bindTexture(gl.TEXTURE_2D, rawPositionTexture1);
        gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, width, height);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

        samplesTexture1 = gl.createTexture();
        gl.activeTexture(gl.TEXTURE4);
        gl.bindTexture(gl.TEXTURE_2D, samplesTexture1);
        gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R16UI, width, height);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

        rawDiffuseTexture2 = gl.createTexture();
        gl.activeTexture(gl.TEXTURE5);
        gl.bindTexture(gl.TEXTURE_2D, rawDiffuseTexture2);
        gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, width, height);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

        rawPositionTexture2 = gl.createTexture();
        gl.activeTexture(gl.TEXTURE6);
        gl.bindTexture(gl.TEXTURE_2D, rawPositionTexture2);
        gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, width, height);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

        samplesTexture2 = gl.createTexture();
        gl.activeTexture(gl.TEXTURE7);
        gl.bindTexture(gl.TEXTURE_2D, samplesTexture2);
        gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R16UI, width, height);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

        atrousTexture1 = gl.createTexture();
        gl.activeTexture(gl.TEXTURE8);
        gl.bindTexture(gl.TEXTURE_2D, atrousTexture1);
        gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, width, height);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

        atrousTexture2 = gl.createTexture();
        gl.activeTexture(gl.TEXTURE9);
        gl.bindTexture(gl.TEXTURE_2D, atrousTexture2);
        gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, width, height);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

        albedoTexture = gl.createTexture();
        gl.activeTexture(gl.TEXTURE10);
        gl.bindTexture(gl.TEXTURE_2D, albedoTexture);
        gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, width, height);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

        fxaaTexture = gl.createTexture();
        gl.activeTexture(gl.TEXTURE11);
        gl.bindTexture(gl.TEXTURE_2D, fxaaTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        
        gl.bindFramebuffer(gl.FRAMEBUFFER, rawFrameBuffer1);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, rawDiffuseTexture1, 0);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, rawPositionTexture1, 0);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT2, gl.TEXTURE_2D, samplesTexture1, 0);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT3, gl.TEXTURE_2D, albedoTexture, 0);
        
        gl.bindFramebuffer(gl.FRAMEBUFFER, rawFrameBuffer2);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, rawDiffuseTexture2, 0);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, rawPositionTexture2, 0);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT2, gl.TEXTURE_2D, samplesTexture2, 0);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT3, gl.TEXTURE_2D, albedoTexture, 0);

        gl.bindFramebuffer(gl.FRAMEBUFFER, atrousFrameBuffer1);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, atrousTexture1, 0);

        gl.bindFramebuffer(gl.FRAMEBUFFER, atrousFrameBuffer2);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, atrousTexture2, 0);

        gl.bindFramebuffer(gl.FRAMEBUFFER, atrousFinalBuffer);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, fxaaTexture, 0);
    };

    //must be called once
    onResize();

    var atrousIterations = 5;

    //atrous blur size
    let atrousSizes = [];
    {
        for (var i = 0; i < atrousIterations; i++) {
            let w1 = Math.floor(Math.pow(2, i));
            let w2 = Math.floor(Math.pow(2, i + 1));

            let arr = [-w2, -w1, 0, w1, w2];

            atrousSizes[i] = [];

            for (var j = 0; j < 25; j++) {
                atrousSizes[i][j * 2] = arr[j % 5];
                atrousSizes[i][j * 2 + 1] = arr[Math.floor(j / 5)];
            }
        }
    }

    //function for a frame, handles uniforms and calls every aspect of the pipeline
    let frame = async () => {
        let lenForward = Math.sqrt(forward.x * forward.x + forward.y * forward.y + forward.z * forward.z);
        let lenRight = Math.sqrt(right.x * right.x + right.y * right.y + right.z * right.z);

        if (lenForward > 0.) {
            forward.x /= lenForward;
            forward.y /= lenForward;
            forward.z /= lenForward;
        }

        if (lenRight > 0.) {
            right.x /= lenRight;
            right.y /= lenRight;
            right.z /= lenRight;
        }

        //ping pong buffers
        if (frames % 2 == 0) {
            gl.bindFramebuffer(gl.FRAMEBUFFER, rawFrameBuffer1);
        } else {
            gl.bindFramebuffer(gl.FRAMEBUFFER, rawFrameBuffer2);
        }

        //set uniforms
        gl.useProgram(rawProgram);
        gl.uniform3f(attributeLocations.raw_position, position.x, position.y, position.z);
        gl.uniform3f(attributeLocations.raw_forward, forward.x, forward.y, forward.z);
        gl.uniform3f(attributeLocations.raw_right, right.x, right.y, right.z);
        gl.uniform2i(attributeLocations.raw_screensize, width, height);
        gl.uniform1i(attributeLocations.raw_frames, frames);
        gl.uniform3f(attributeLocations.raw_lForward, lastForward.x, lastForward.y, lastForward.z);
        gl.uniform3f(attributeLocations.raw_lRight, lastRight.x, lastRight.y, lastRight.z);
        gl.uniform3f(attributeLocations.raw_lPosition, lastPosition.x, lastPosition.y, lastPosition.z);
        if (frames % 2 == 0) {
            gl.uniform1i(attributeLocations.raw_lColor, 5);
            gl.uniform1i(attributeLocations.raw_lWorldPosition, 6);
            gl.uniform1i(attributeLocations.raw_samples, 7);
        } else {
            gl.uniform1i(attributeLocations.raw_lColor, 2);
            gl.uniform1i(attributeLocations.raw_lWorldPosition, 3);
            gl.uniform1i(attributeLocations.raw_samples, 4);
        }

        //adjust resolution, buffers, etc. on screen size change
        var sizeChanged = resizeCanvasToDisplaySize(canvas);

        if (sizeChanged) {
            width = canvas.width;
            height = canvas.height;
            //recreate the texture that is the target to render to
            onResize();
        }

        //pipeline

        //raw 1spp
        gl.viewport(0, 0, width, height);
        gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2, gl.COLOR_ATTACHMENT3]);
        drawFragment(gl, rawProgram, attributeLocations.rawPosition);
        
        //atrous denoising
        gl.useProgram(denoiseProgram);
        gl.uniform2i(attributeLocations.denoise_screensize, width, height);
        if (frames % 2 == 0) {
            gl.uniform1i(attributeLocations.denoise_color1, 2);
            gl.uniform1i(attributeLocations.denoise_position1, 3);
            gl.uniform1i(attributeLocations.denoise_samples1, 4);
        } else {
            gl.uniform1i(attributeLocations.denoise_color1, 5);
            gl.uniform1i(attributeLocations.denoise_position1, 6);
            gl.uniform1i(attributeLocations.denoise_samples1, 7);
        }

        gl.uniform1i(attributeLocations.denoise_last, 0);

        for (var i = 0; i < atrousIterations; i++) {
            //ping pong buffers
            if (i % 2 == 0) {
                if (i == atrousIterations - 1) {
                    //switch which buffer it writes to
                    gl.bindFramebuffer(gl.FRAMEBUFFER, atrousFinalBuffer);
                    gl.viewport(0, 0, width, height);
                    gl.uniform1i(attributeLocations.denoise_last, 1);
                } else {
                    //switch which buffer it writes to
                    gl.bindFramebuffer(gl.FRAMEBUFFER, atrousFrameBuffer1);
                    gl.viewport(0, 0, width, height);  
                }
                //switch which buffer it reads from
                //skips on 1 because it should read the ping-ponged raw buffer
                if (i != 0) {
                    gl.uniform1i(attributeLocations.denoise_color1, 9);
                }
            } else {
                if (i == atrousIterations - 1) {
                    gl.bindFramebuffer(gl.FRAMEBUFFER, atrousFinalBuffer);
                    gl.viewport(0, 0, width, height);
                    gl.uniform1i(attributeLocations.denoise_last, 1);
                } else {
                    //switch which buffer it writes to
                    gl.bindFramebuffer(gl.FRAMEBUFFER, atrousFrameBuffer2);
                    gl.viewport(0, 0, width, height);
                }               
                //switch which buffer it reads from 
                gl.uniform1i(attributeLocations.denoise_color1, 8);
            }

            gl.uniform2iv(attributeLocations.denoise_offset, atrousSizes[i]);
            gl.uniform1i(attributeLocations.denoise_steps, i);
            drawFragment(gl, denoiseProgram, attributeLocations.denoisePosition);
        }

        //FXAA
        gl.useProgram(fxaaProgram);
        gl.uniform1i(attributeLocations.fxaa_color, 11);
        gl.uniform2f(attributeLocations.fxaa_screensize, width, height);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, width, height);
        drawFragment(gl, fxaaProgram, attributeLocations.fxaaPosition);

        
        frames++;

        lastForward.x = forward.x;
        lastForward.y = forward.y;
        lastForward.z = forward.z;
        lastRight.x = right.x;
        lastRight.y = right.y;
        lastRight.z = right.z;
        lastPosition.x = position.x;
        lastPosition.y = position.y;
        lastPosition.z = position.z;
    };

    return {
        frame: frame,
        setForward: (inval) => {
            if ("x" in inval) {
                if ("y" in inval) {
                    if ("z" in inval) {
                        forward = inval;
                        return;
                    }
                }
            }
            return;
        },
        getForward: () => forward,
        setRight: (inval) => {
            if ("x" in inval) {
                if ("y" in inval) {
                    if ("z" in inval) {
                        right = inval;
                        return;
                    }
                }
            }
            return;
        },
        getRight: () => right,
        setPosition: (inval) => {
            if ("x" in inval) {
                if ("y" in inval) {
                    if ("z" in inval) {
                        position = inval;
                        return;
                    }
                }
            }
            return;
        },
        getPosition: () => position
    };
}

//helper functions

//for creating state arrays:
//set function with everything precomputed
function setPre(array, offset, div2, div, x, y, z, val) {
    array[offset + div2 * x + div * y + z] = val;
}

//get the value of the array with everything precomputed
function fetchPre(array, offset, div2, div, x, y, z) {
    return array[offset + div2 * x + div * y + z];
}

//async/await load image
//https://www.fabiofranchino.com/log/load-an-image-with-javascript-using-await/
function loadImage(path) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'Anonymous';
        img.src = path;
        img.onload = () => {
            resolve(img);
        };
        img.onerror = (e) => {
            reject(e);
        }
    });
};

//creates program from 2 shaders
function createProgram(gl, vertexShader, fragmentShader) {
    //create a program
    var program = gl.createProgram();

    //attach the shaders
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);

    //link the program
    gl.linkProgram(program);

    //Check if it linked
    var success = gl.getProgramParameter(program, gl.LINK_STATUS);
    if (!success) {
        //something went wrong with the link
        console.log("Program link failed:\n" + gl.getProgramInfoLog(program));
    }

    return program;
}

//compiles a shader
function compileShader(gl, shaderSource, shaderType) {
    //create the shader object
    var shader = gl.createShader(shaderType);

    //Set the shader source code
    gl.shaderSource(shader, shaderSource);

    //compile the shader
    gl.compileShader(shader);

    //check if compile was successful
    var success = gl.getShaderParameter(shader, gl.COMPILE_STATUS);
    if (!success) {
        console.log("Could not compile shader:\n" + gl.getShaderInfoLog(shader));
    }

    return shader;
}

//creates a program from 2 shader sources
function createProgramFromScripts(gl, vertexScript, fragmentScript) {
    //create shaders
    var vertexShader = compileShader(gl, vertexScript, gl.VERTEX_SHADER);
    var fragmentShader = compileShader(gl, fragmentScript, gl.FRAGMENT_SHADER);

    //create and return the actual program
    return createProgram(gl, vertexShader, fragmentShader);
}

//resize canvas to make correct
function resizeCanvasToDisplaySize(canvas) {
    //lookup the size the browser is displaying the canvas at in css pixels
    const displayWidth = canvas.clientWidth;
    const displayHeight = canvas.clientHeight;

    //check if the canvas is not the same size
    const needResize = canvas.width !== displayWidth || canvas.height !== displayHeight;

    if (needResize) {
        //resize the canvas
        canvas.width = displayWidth;
        canvas.height = displayHeight;
    }

    return needResize;
}

//execute a fragment shader onto a full screen quad
function drawFragment(gl, program, positionAttributeLocation) {
    //use program
    gl.useProgram(program);

    //create triangle buffer
    var positionBuffer = gl.createBuffer();

    //bind buffer to ARRAY_BUFFER
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);

    //clippos vertex positions
    var positions = [-1, -1, -1, 1, 1, 1, -1, -1, 1, 1, 1, -1];
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);

    //create a vertex array object (handles attribute state)
    var vao = gl.createVertexArray();

    //make vao the current vertex array we are editing
    gl.bindVertexArray(vao);

    gl.enableVertexAttribArray(positionAttributeLocation);

    //settings for how to read positions
    var size = 2;
    var type = gl.FLOAT;
    var normalize = false;
    var stride = 0;
    var offset = 0;

    gl.vertexAttribPointer(positionAttributeLocation, size, type, normalize, stride, offset);

    //resize canvas
    resizeCanvasToDisplaySize(gl.canvas);

    //clear the canvas
    //gl.clearColor(1, 0, 0, 0);
    //gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    //tell gl to use our program
    gl.useProgram(program);

    //bind the attribute/buffer set we want
    gl.bindVertexArray(vao);

    //draw
    var primitiveType = gl.TRIANGLES;
    var offset = 0;
    var count = 6;
    gl.drawArrays(primitiveType, offset, count);
}


