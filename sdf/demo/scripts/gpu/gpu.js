//Class for interfacing with GPU
/*
functionality:
-compile shader code
-create pipeline, bg layout, etc.
-updateUniforms() sets uniform values provided by call
-render() returns an image/array from gpu
*/

let temp = `
//put any uniforms here, in the format
//if you are adding additional uniforms, place a comma before the first
//name : type, //[input method]
//valid input methods: [default value] or [default, min, max, step]
//valid types: i32, f32, u32, vec[1,2,3,4]<i32/f32/u32>
 power : f32, // [1.0, 0.5, 4.0, .01]
 cutoff : f32, //[2.5, .1, 10., .01]
 steps : i32, //[4, 1, 10, 1]

//Code:
fn DE(z : vec3<f32>) -> f32 {
    return  fractal(z - vec3<f32>(0., 0., uniforms.cutoff));
}

fn fractal(z : vec3<f32>) -> f32 {
    if (length(z) > uniforms.cutoff * 1.1) {
        return length(z) - uniforms.cutoff;
    }
    return max(AP(z, uniforms.power), length(z) - uniforms.cutoff);

}

fn AP(z : vec3<f32>, s : f32) -> f32 {
    var p = z;
    var Scale = 1.;
    var orb = vec4<f32>(1000.);

    for (var i = 0; i < uniforms.steps; i = i + 1) {
        p = -1. + 2. * fract(0.5 * p + .5);

        var r2 = dot(p, p);

        orb = min(orb, vec4<f32>(abs(p), r2));

        var k = s / r2;

        p = p * k;
        Scale = Scale * k;

        //p = planefold(p, normalize(vec3<f32>(1., 1., 0.)));
        //p.x = abs(p.x);
    }

    return .25 * min(min(abs(p.z), abs(p.y)), abs(p.x)) / Scale;
}
`;

let shaderCode = `
struct uniforms_type {
    frames : i32,
    canvas : vec2<i32>,
    groups : vec2<i32>,
    position : vec3<f32>,
    forward : vec3<f32>,
    right : vec3<f32>,
    pinhole : f32,
    zoom : f32,
    reset : i32,
    pathtrace : i32,
    epsilon : f32,
    iterations : i32,
    temp1 : f32,
    bounces : i32,
    sunpos : vec2<f32>,
    floor : i32,
    focallength : f32,
    aperture : f32,
    breakout: f32,
    //BREAK_FOR_UNIFORMS

}

struct ray {
    pos : vec3<f32>,
    dir : vec3<f32>
}

struct rayhit {
    ao : f32,
    pos : vec3<f32>,
    norm : vec3<f32>,
    dist : f32,
    hit : bool
}

@group(0) @binding(0) var<storage, read> uniforms : uniforms_type;
@group(0) @binding(1) var<storage, read_write> result : array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> accum : array<vec4<f32>>;

//constants/random seed
var<private> E : f32 = 2.71828182845904523536028747135266249775724709369995957;
var<private> PI : f32 = 3.141592653589793238462643383279502884197169;
var<private> seed : vec2<f32>;

//for sunsky model - CHANGE LATER
//CHANGE TO VARIABLE LATER
var<private> skyfactor = 1.;

var<private> sundirection : vec3<f32>; 

var<private> sunangulardiametercos : f32;

//angular sun size, default (physical) is .53 degrees
var<private> sunsize = .53;

//get the initial depth to the scene
var<private> first = true;
var<private> depth = 1.;

//main
@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) global_id : vec3<u32>) {
    //screenspace coordinates
    var sspace : vec2<f32> = vec2<f32>(global_id.xy) / vec2<f32>(uniforms.canvas);

    if (sspace.x > 1. || sspace.y > 1.) {
        setResult(global_id, vec4<f32>(1., 0., 0., 1.));
        return;
    }

    //for sunsky model
    sundirection = normalize(fromSpherical((uniforms.sunpos-vec2<f32>(0.0,0.5))*vec2<f32>(6.28,3.14)));
    sunangulardiametercos = cos(sunsize * PI / 180.0);

    //seed for 'random' numbers
    seed = vec2<f32>(global_id.xy) * max(.01, abs(sin(f32(uniforms.frames + 1))));

    //if greater than 1, path trace
    if (uniforms.pathtrace > 0) {
        //if accumulation buffer should be reset
        if (uniforms.reset > 0) {
            resetAccum(global_id);
        }

        //screen position - should be jittered for AA
        var screenpos = vec2<f32>(1., -1.) * (vec2<f32>(global_id.xy) + 1. * srand2n() * .5 - .5 * vec2<f32>(uniforms.canvas)) / f32(uniforms.canvas.y);

        //get pixel's ray
        var o : ray;
        o.pos = uniforms.position + uniforms.forward * uniforms.pinhole * uniforms.zoom + uniforms.zoom * (normalize(-cross(uniforms.right, uniforms.forward)) * screenpos.y + uniforms.right * screenpos.x);
        o.dir = normalize(o.pos - uniforms.position);

        //stochastic depth of field
        var focalpoint = o.pos + o.dir * uniforms.focallength;
        screenpos += uniforms.aperture * srand2n();

        //recalculate ray origin, shifted by aperture
        o.pos = uniforms.position + uniforms.forward * uniforms.pinhole * uniforms.zoom + uniforms.zoom * (normalize(-cross(uniforms.right, uniforms.forward)) * screenpos.y + uniforms.right * screenpos.x); 
        o.dir = normalize(focalpoint - o.pos);

        var res = sample(o);

        //get color for current sample on current pixel
        var samplecolor = (vec3<f32>(res));
        
        samplecolor = min(samplecolor, vec3<f32>(1.));
        
        var final = setAccum(global_id, vec4<f32>(samplecolor, 1.));
        //final.xyz / final.a
        setResult(global_id, vec4<f32>(acesGamma(final.xyz / final.a), depth));
    } else { //regular render - not path traced
        var screenpos = vec2<f32>(1., -1.) * (vec2<f32>(global_id.xy) - .5 * vec2<f32>(uniforms.canvas)) / f32(uniforms.canvas.y);

        if (uniforms.reset > 0) {
            resetAccum(global_id);
        }

        //get pixel's ray
        var o : ray;
        o.pos = uniforms.position + uniforms.forward * uniforms.pinhole * uniforms.zoom + uniforms.zoom * (normalize(-cross(uniforms.right, uniforms.forward)) * screenpos.y + uniforms.right * screenpos.x);
        o.dir = normalize(o.pos - uniforms.position);

        var res = intersect(o);
        setResult(global_id, vec4<f32>(vec3<f32>(f32(res.hit)) * res.ao * getColor(res.pos), f32(depth)));
    } 
}

//add value to accumulation buffer and return total
fn setAccum(index : vec3<u32>, val : vec4<f32>) -> vec4<f32> {
    accum[index.x + index.y * u32(uniforms.groups.x)] = accum[index.x + index.y * u32(uniforms.groups.x)] + val;
    //return the value of the accumulation buffer
    return accum[index.x + index.y * u32(uniforms.groups.x)];
}

//reset accumulation buffer
fn resetAccum(index : vec3<u32>) {
    accum[index.x + index.y * u32(uniforms.groups.x)] = vec4<f32>(0.);
}

//set result buffer (buffer that gets read)
fn setResult(index : vec3<u32>, val : vec4<f32>) {
    result[index.x + index.y * u32(uniforms.groups.x)] = val;
}

//color correction
fn acesGamma(x : vec3<f32>) -> vec3<f32> {
    //perform aces and gamma color correction
    return pow(clamp((x * (x * 2.51 + .03)) / (x * (2.43 * x + .59) + .14), vec3<f32>(0.), vec3<f32>(1.)), vec3<f32>(1. / 2.2));
}

//random generators
//get a random, normalized vec2
fn rand2n() -> vec2<f32> {
    seed = seed + vec2<f32>(1., -1.);
    return hash22(seed);
}

//returns a signed random vec2
fn srand2n() -> vec2<f32> {
    var r = rand2n() * vec2<f32>(2. * PI, 1.);
    return vec2(cos(r.x) * r.y, sin(r.x)  * r.y);
    
};

//new hash?
//https://www.shadertoy.com/view/4djSRW
fn hash22(p : vec2<f32>) -> vec2<f32> {
	var p3 = fract(vec3<f32>(p.xyx) * vec3<f32>(.1031, .1030, .0973));
    p3 = p3 + dot(p3, p3.yzx+33.33);
    return fract((p3.xx+p3.yz)*p3.zy);

}

//scene intersection function
fn intersect(o : ray) -> rayhit {
    if (uniforms.floor == 0) {
        var res = march(o);

        if (first) {
            first = false;
            depth = res.dist;
        }

        return res;
    }

    //for analytic
    var temp : ahit = ground(o);

    var march : rayhit = march(o);

    //ray hit the ground
    if ((!march.hit || temp.dist < march.dist) && temp.hit) {
        var returned : rayhit;
        returned.dist = temp.dist;
        returned.hit = true;
        returned.pos = o.pos + o.dir * returned.dist;
        returned.ao = .5;
        returned.norm = vec3<f32>(0., 0., 1.);

        //initial depth for CPU side
        if (first) {
            first = false;
            depth = returned.dist;
        }

        return returned;
    }

    //initial depth for CPU side
    if (first) {
        first = false;
        depth = march.dist;
    }

    return march;
}

//analytic intersection functions
struct ahit {
    dist : f32,
    norm : vec3<f32>,
    hit : bool
}

//floor
fn ground(o : ray) -> ahit {
    var returned : ahit;
    //if it does not intersect
    if (o.dir.z >= 0.) {
        returned.hit = false;
        return returned;
    }
    //did hit
    returned.dist = -o.pos.z / o.dir.z;
    returned.norm = vec3<f32>(0., 0., 1.);
    returned.hit = true;
    return returned;
}

//raymarching function
fn march(o : ray) -> rayhit {
    var returned : rayhit;

    //set initial pos
    returned.pos = o.pos;

    //i value used for AO
    var i = 0;
    for ( ; i < uniforms.iterations; i = i + 1) {
        //get current distance to scene
        var d = DE(returned.pos);

        //increment position along ray
        returned.pos = returned.pos + d * o.dir;

        //increase distance travelled
        returned.dist = returned.dist + d;

        //we have intersected the fractal
        if (d < uniforms.epsilon) {
            returned.hit = true;
            break;
        }

        //we have gotten sufficiently far from the fractal
        if (d > uniforms.breakout) {
            returned.hit = false;
            returned.ao = 0.;
            return returned;
        }
    }

    //if did not hit
    if (i == uniforms.iterations - 1) {
        returned.hit = false;
        return returned;
    }

    //use number of iterations as AO estimate
    returned.ao = f32(uniforms.iterations - i) / f32(uniforms.iterations);
    //get the normal at the surface
    returned.norm = getNormal(returned.pos);

    return returned;
}

//get normal from point
fn getNormal(z : vec3<f32>) -> vec3<f32> {
    var eps = max(uniforms.epsilon * .5, 1.0e-7);
    var ez = vec3<f32>(0., 0., eps);
    var ex = vec3<f32>(eps, 0., 0.);
    var ey = vec3<f32>(0., eps, 0.);
    return (normalize(vec3<f32>(DE(z + ex) - DE(z - ex),
        DE(z + ey) - DE(z - ey),
        DE(z + ez) - DE(z - ez)
    )));
}

//path tracing
fn sample(o : ray) -> vec3<f32> {
    //the current hit
    var cur : ray = o;

    //hit pos and normal
    var hitpos = vec3<f32>(0.);
    var hitnormal = vec3<f32>(0.);

    //current color, modulated along steps
    var color = vec3<f32>(1.);
    //color accumulated by next event estimation
    var direct = vec3<f32>(0.);

    //number of bounces
    var RayDepth = uniforms.bounces;

    //main loop
    for (var i = 0; i < RayDepth; i = i + 1) {
        var res = intersect(cur);

        //if we hit a surface, modulate color
        if (res.hit) {
            //find new ray direction
            cur.dir = getCosineWeightedSample(res.norm);
            //find new ray position
            cur.pos = res.pos + res.norm * uniforms.epsilon * 2.;

            //modulate color
            color = color * getColor(res.pos);

            //create ray for next event estimation
            var suncheck : ray;
            suncheck.pos = cur.pos;
            suncheck.dir = getConeSample(sundirection, 1. - sunangulardiametercos);
            
            //sun's effect on surface
            var sunlight = dot(res.norm, suncheck.dir);
            //if is in view of sun
            if (sunlight > 0. && !intersect(suncheck).hit) {
                direct = direct + color * sun(suncheck.dir) * sunlight * 1e-5;
            }

        } else {//if we missed, modulate and return color by atmospheric light
            if (i > 0) {
                return direct + color * sky(cur.dir);
            }
            return direct + color * sunsky(cur.dir);
        }
    }

    //return 0 if ray failed to find light source
    return vec3<f32>(0.);
}

//get a ortho vector
fn ortho(v : vec3<f32>) -> vec3<f32> {
    if (abs(v.x) > abs(v.y)) {
        return vec3<f32>(-v.y, v.x, 0.);
    }
    return  vec3<f32>(0., -v.z, v.y);
}

//bias sample by value
fn getSampleBiased(dir : vec3<f32>, power : f32) -> vec3<f32> {
    var o1 = normalize(ortho(dir));
    var o2 = normalize(cross(dir, o1));
    var r = rand2n();
    r.x = r.x * 2. * 3.1415926535897932;
    r.y = pow(r.y, 1. / (power + 1.));
    var oneminus = sqrt(1. - r.y * r.y);
    return cos((r.x)) * oneminus * o1 + sin((r.x)) * oneminus * o2 + r.y * dir;
}

//get sample, biased to 1
fn getCosineWeightedSample(dir : vec3<f32>) -> vec3<f32> {
    return getSampleBiased(dir, 1.);
}

//sample cone direction for sun
//https://github.com/Syntopia/Fragmentarium/blob/master/Fragmentarium-Source/Examples/Include/Sky-Pathtracer.frag
fn getConeSample(dir : vec3<f32>, extent : f32) -> vec3<f32> {
    //create basis for coordinate system
    var o1 = normalize(ortho(dir));
    var o2 = normalize(cross(dir, o1));

    //random
    var r = rand2n();

    r.x = r.x * 2. * PI;
    r.y = 1. - r.y * extent;

    var oneminus = sqrt(1. - r.y * r.y);
    return cos(r.x) * oneminus * o1 + sin(r.x) * oneminus * o2 + r.y * dir;
}

//sky model
//https://github.com/Syntopia/Fragmentarium/blob/master/Fragmentarium-Source/Examples/Include/Sunsky.frag

var<private> turbidity = 2.;

var<private> miecoefficient = .005;
var<private> miedirectionalg = .8;

var<private> n = 1.003;//refractive index of air
var<private> N = 2.545e25;// number of molecules per 1m^3 of air,
//@ 288.15K and 1013mb 

//wavelengths of used primaries
var<private> primarywavelengths = vec3<f32>(680e-9, 550e-9, 450e-9);

//K coefficients for primaries
var<private> K = vec3<f32>(.686, .678, .666);
var<private> v = 4.;

//optical lengths at zenith for molecules
var<private> rayleighzenithlength = 8.4e3;
var<private> miezenithlength = 1.25e3;
var<private> up = vec3<f32>(0., 0., 1.);

var<private> sunintensity = 1000.;

//earth shadow hack (?)
var<private> cutoffangle = 1.611073156;
var<private> steepness = 1.5;

fn rayleighPhase(c : f32) -> f32 {
    return (3. / (16. * PI)) * (1. + pow(c, 2.));
}

fn totalMie(primary : vec3<f32>, k : vec3<f32>, t : f32) -> vec3<f32> {
    var c = (.2 * t) * 10e-18;
    return .434 * c * PI * pow((2. * PI) / primary, vec3<f32>(v - 2.)) * k;
}

fn hgPhase(c : f32, g : f32) -> f32 {
    return (1. / (4. * PI)) * ((1. - pow(g, 2.)) / pow(1. - 2. * g * c + pow(g, 2.), 1.5));
}

fn sunIntensity(z : f32) -> f32 {
    return sunintensity * max(0.0, 1.0 - exp(-((cutoffangle - (acos(z)))/steepness)));
}

fn fromSpherical(p : vec2<f32>) -> vec3<f32> {
    return vec3<f32>(cos(p.x) * sin(p.y), sin(p.x) * sin(p.y), cos(p.y));
}

fn sun(viewdir : vec3<f32>) -> vec3<f32> {
	// Cos Angles
	var cosviewsunangle = dot(viewdir, sundirection);
	var cossunupangle = dot(sundirection, up);
	var cosupviewangle = dot(up, viewdir);

	var sune = sunIntensity(cossunupangle);  // Get sun intensity based on how high in the sky it is
	// extinction (asorbtion + out scattering)
	// rayleigh coeficients
	var rayleighatx = vec3<f32>(5.176821e-6, 1.2785348e-5, 2.8530756e-5);
	
	// mie coefficients
	var mieatx = totalMie(primarywavelengths, K, turbidity) * miecoefficient;
	
	// optical length
	// cutoff angle at 90 to avoid singularity in next formula.
	var zenithangle = max(0.0, cosupviewangle);
	
	var rayleighopticallength = rayleighzenithlength / zenithangle;
	var mieopticallength = miezenithlength / zenithangle;
	
	
	// combined extinction factor
	var Fex = exp(-(rayleighatx * rayleighopticallength + mieatx * mieopticallength));
	
	// in scattering
	var rayleighxtoeye = rayleighatx * rayleighPhase(cosviewsunangle);
	var miextoeye = mieatx *  hgPhase(cosviewsunangle, miedirectionalg);
	
	var totallightatx = rayleighatx + mieatx;
	var lightfromxtoeye = rayleighxtoeye + miextoeye;
	
	var somethingelse = sune * (lightfromxtoeye / totallightatx);
	
	var sky = somethingelse * (1.0 - Fex);
	sky *= mix(vec3(1.0),pow(somethingelse * Fex,vec3<f32>(0.5)),clamp(pow(1.0-dot(up, sundirection),5.0),0.0,1.0));
	// composition + solar disc
	
    //float sundisk = smoothstep(sunAngularDiameterCos,sunAngularDiameterCos+0.00002,cosViewSunAngle);
	var sundisk : f32 = f32(sunangulardiametercos < cosviewsunangle);

	//	smoothstep(sunAngularDiameterCos,sunAngularDiameterCos+0.00002,cosViewSunAngle);
	var sun = (sune * 19000.0 * Fex)*sundisk;
	
	return 0.01*sun;
}

fn sky(viewdir : vec3<f32>) -> vec3<f32> {
	// Cos Angles
	var cosviewsunangle = dot(viewdir, sundirection);
	var cossunupangle = dot(sundirection, up);
	var cosupviewangle = dot(up, viewdir);
	
	var sune = sunIntensity(cossunupangle);  // Get sun intensity based on how high in the sky it is
	// extinction (asorbtion + out scattering)
	// rayleigh coeficients
	var rayleighatx = vec3<f32>(5.176821e-6, 1.2785348e-5, 2.8530756e-5);
	
	// mie coefficients
	var mieatx = totalMie(primarywavelengths, K, turbidity) * miecoefficient;
	
	// optical length
	// cutoff angle at 90 to avoid singularity in next formula.
	var zenithangle = max(0.0, cosupviewangle);
	
	var rayleighopticallength = rayleighzenithlength / zenithangle;
	var mieopticallength = miezenithlength / zenithangle;
	
	
	// combined extinction factor
	var Fex = exp(-(rayleighatx * rayleighopticallength + mieatx * mieopticallength));
	
	// in scattering
	var rayleighxtoeye = rayleighatx * rayleighPhase(cosviewsunangle);
	var miextoeye = mieatx *  hgPhase(cosviewsunangle, miedirectionalg);
	
	var totallightatx = rayleighatx + mieatx;
	var lightfromxtoeye = rayleighxtoeye + miextoeye;
	
	var somethingelse = sune * (lightfromxtoeye / totallightatx);
	
	var sky = somethingelse * (1.0 - Fex);
	sky *= mix(vec3(1.0),pow(somethingelse * Fex,vec3(0.5)),clamp(pow(1.0-dot(up, sundirection),5.0),0.0,1.0));
	// composition + solar disc
	
	var sundisk = smoothstep(sunangulardiametercos,sunangulardiametercos+0.00002,cosviewsunangle);
	var sun = (sune * 19000.0 * Fex)*sundisk;
	
	return skyfactor*0.01*(sky);
}

fn sunsky(viewdir : vec3<f32>) -> vec3<f32> {
	// Cos Angles
	var cosviewsunangle = dot(viewdir, sundirection);
	var cossunupangle = dot(sundirection, up);
	var cosupviewangle = dot(up, viewdir);
	if (sunangulardiametercos == 1.0) {
	    return vec3(1.0,0.0,0.0);
    }

	var sune = sunIntensity(cossunupangle);  // Get sun intensity based on how high in the sky it is
	// extinction (asorbtion + out scattering)
	// rayleigh coeficients
	var rayleighatx = vec3<f32>(5.176821e-6, 1.2785348e-5, 2.8530756e-5);
	
	// mie coefficients
	var mieatx = totalMie(primarywavelengths, K, turbidity) * miecoefficient;
	
	// optical length
	// cutoff angle at 90 to avoid singularity in next formula.
	var zenithangle = max(0.0, cosupviewangle);
	
	var rayleighopticallength = rayleighzenithlength / zenithangle;
	var mieopticallength = miezenithlength / zenithangle;
	
	
	// combined extinction factor
	var Fex = exp(-(rayleighatx * rayleighopticallength + mieatx * mieopticallength));
	
	// in scattering
	var rayleighxtoeye = rayleighatx * rayleighPhase(cosviewsunangle);
	var miextoeye = mieatx *  hgPhase(cosviewsunangle, miedirectionalg);
	
	var totallightatx = rayleighatx + mieatx;
	var lightfromxtoeye = rayleighxtoeye + miextoeye;
	
	var somethingelse = sune * (lightfromxtoeye / totallightatx);
	
	var sky = somethingelse * (1.0 - Fex);
	sky *= mix(vec3<f32>(1.0),pow(somethingelse * Fex,vec3<f32>(0.5)),clamp(pow(1.0-dot(up, sundirection),5.0),0.0,1.0));
	// composition + solar disc
	
	var sundisk = smoothstep(sunangulardiametercos,sunangulardiametercos+0.00002,cosviewsunangle);
	var sun = (sune * 19000.0 * Fex)*sundisk;
	
	return 0.01*(sun+sky);
}

`;

class gpu {

    //external params, should include:
    //canvas width/height
    //shader code url
    params = {};
    
    buffers = {};

    //info is internal and calculated from params and/or created in methods, i.e.
    //uniform buffer length
    //code stores fetched server code
    //toDelete stores guiValues variable names to delete
    info = {code: {}, toDelete: []};

    //constructor to set params
    constructor(params) {
        this.params = params;
        //init
        this.init();
    }

    //calculates other paramaters, including number of groups, etc. called from constructor or reset
    init() {
        this.info.uniformBufferSize = this.flexArrByteLength(this.params.uniforms);
        //calculate buffer size and number of work groups
        this.calculateGroupSize(this.params.canvasX, this.params.canvasY);
    }

    //get base code from server
    async baseCode() {
        //shaderCode from seperate file
        //;//await fetch(this.params.shaderCode).then(result => result.text());
        //split shader code into the two parts for the compiler
        let split = shaderCode.split("//BREAK_FOR_UNIFORMS");
        //between above and below, the uniforms are entered
        this.info.code.above = split[0];
        this.info.code.below = split[1];
    }

    //recalculate the size of the groups, size of result buffer, etc.
    calculateGroupSize(canvasX, canvasY) {
        //for getTrimmedImage()
        this.params.canvasX = canvasX;
        this.params.canvasY = canvasY;
        //for workgroup size
        this.info.groupsX = canvasX + ((16 - (canvasX % 16)) % 16);
        this.info.groupsY = canvasY + ((16 - (canvasY % 16)) % 16);
        this.info.imageBufferSize = Float32Array.BYTES_PER_ELEMENT * this.info.groupsX * this.info.groupsY * 4;
    }

    //when shader is updated
    async reset(snippet) {
        //destroy all buffers
        for (var x in this.buffers) {
            if (this.buffers[x]) {
                this.buffers[x].destroy();
            }
        }
        this.setJSUniforms(snippet);
        //reset sizes for render and uniform buffers
        await this.init();
        //recreate buffers and stuff
        await this.prep();
        //recompile shader
        await this.compileShader(snippet);
    }

    //use user snippet to update the uniforms objects on either
    setJSUniforms(snippet) {
        //the straight code
        let lines = snippet.split("//Code:")[0].split("//valid types: i32, f32, u32, vec[1,2,3,4]<i32/f32/u32>\n")[1].split("\n");
        let num = lines.length;

        let variables = [];

        for (var i = 0; i < num; i++) {
            //current line
            var line = lines[i];
            //get webGPU aspects of variable
            let type, dim, name;
            name = line.match(/[a-zA-Z][a-zA-Z1-9_]*/);
            type = line.match(/[ifu]32/);
            dim = line.match(/vec([1-4])/);

            //get datGUI aspects of variable
            let slider = true;
            let start, min, max, step;

            slider = line.match(/\[([0-9.e\-]+)\]/);

            let ignore = false;
            if (slider != null) {
                start = slider[1];
                slider = false;
            } else {
                slider = line.match(/\[\s*([0-9e.\-]+)\s*,\s*([0-9e.\-]+)\s*,\s*([0-9e.\-]+)\s*,\s*([0-9e.\-]+)\]/);
                //slider is not found - ignoring this line
                if (slider === null) {
                    ignore = true;
                } else {
                    start = slider[1];
                    min = slider[2];
                    max = slider[3];
                    step = slider[4];
                    slider = true;
                }
            }

            //if the line is a comment, or something
            if (!type) {
                ignore = true;
            }

            if (ignore) {
            } else { //else we found a successful line
                variables[variables.length] = {
                    name: name[0],
                    type: type[0],
                    dim: dim == null ? 1 : parseInt(dim[1]),
                    slider,
                    start: parseFloat(start),
                    min: parseFloat(min),
                    max: parseFloat(max),
                    step: parseFloat(step)
                };
            }
        }

        const appended = ["_x", "_y", "_z", "_w"];
        //go through and delete all previous variables
        for (var x in this.info.toDelete) {
            //current name of thing to clear
            let cur = this.info.toDelete[x];

            delete this.params.uniforms[cur.name];

            if (cur.dim == 1) {
                delete this.params.guiValues[cur.name];
                delete this.params.lastValues[cur.name];
            } else {
                
                for (var y = 0; y < cur.dim; y++) {
                    delete this.params.guiValues[cur.name + appended[y]];
                    delete this.params.lastValues[cur.anem + appended[y]];
                }
            }
        }

        //reset what main needs to know about user variables
        this.params.userVariables.arr = [];

        //delete the GUI folder
        this.params.gui.removeFolder("Fractal Structure");

        const fFolder = this.params.gui.addFolder("Fractal Structure");
        fFolder.open();

        //now everything is reset and we can recreate it
        for (var x in variables) {
            let cur = variables[x];

            //set up to be able to delete later
            this.info.toDelete[this.info.toDelete.length] = {
                name: cur.name,
                dim: cur.dim
            };
            //add to "uniforms" object
            this.params.uniforms[cur.name] = {
                type: cur.type,
                dim: cur.dim,
                val: [0., 0., 0., 0.]
            };

            if (cur.dim == 1) {
                this.addToGUI(fFolder, cur.name, cur.slider, cur.start, cur.min, cur.max, cur.step);
                //links gui and uniform values 
                this.params.userVariables.arr[this.params.userVariables.arr.length] = {
                    name: cur.name,
                    guiNames: [cur.name]
                };
            } else {
                let guiNamesSet = [];
                for (var y = 0; y < cur.dim; y++) {
                    this.addToGUI(fFolder, cur.name + appended[y], cur.slider, cur.start, cur.min, cur.max, cur.step);
                    guiNamesSet[guiNamesSet.length] = cur.name + appended[y];
                }
                //links gui and uniform values 
                this.params.userVariables.arr[this.params.userVariables.arr.length] = {
                    name: cur.name,
                    guiNames: guiNamesSet
                };
            }
        }

        fFolder.domElement.parentNode.querySelectorAll(".cr").forEach(
            x => {
               x.style = "border-left: 3px solid #2FA1D6"; 
            }
        );
    }

    //helper function to add to GUI
    addToGUI(folder, name, slider, start, min, max, step) {
        this.params.guiValues[name] = start;

        //value that is typed in
        if (slider == false) {
            folder.add(this.params.guiValues, name);
        } else { //slider value
            folder.add(this.params.guiValues, name, min, max, step);
        }

        //for resetting path tracing when a value changes
        this.params.lastValues[name] = start;
    }  

    //fetches shader code, compiles, creates requisite buffers, etc.
    async prep() {
        //webGPU adapter
        const adapter = await navigator.gpu.requestAdapter({powerPreference: 'high-performance'});

        //check if webGPU unsupported
        if (!adapter) {
            alert("WebGPU not supported!");
            return;
        }

        //webGPU device - store
        const device = await adapter.requestDevice();

        //Size, in bytes, of image to store result and previous frame in
        const imageBufferSize = this.info.imageBufferSize;

        //buffer to store uniforms (width/height, position, rotation, etc.) on gpu
        const uniformBuffer = device.createBuffer({
            size: this.info.uniformBufferSize,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
        });

        //buffer that samples are accumulated into
        const accumBuffer = device.createBuffer({
            size: imageBufferSize,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
        });

        //buffer that workers write two and is returned as a result of render()
        const imageBuffer = device.createBuffer({
            size: imageBufferSize,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
        });

        //buffer that can be mapped and read by CPU, COPY_DST for imageBuffer
        const readBuffer = device.createBuffer({
            size: imageBufferSize,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
            mappedAtCreation: false
        });

        //bindgroup layout for pipeline
        const bindGroupLayout = device.createBindGroupLayout({
            entries: [
                {//uniform buffer
                    binding: 0,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: {
                        type: "read-only-storage"
                    }
                },
                {//imageBuffer
                    binding: 1,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: {
                        type: "storage"
                    }
                },
                {//accum buffer
                    binding: 2,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: {
                        type: "storage"
                    }
                }
            ]
        });

        //actual bindgroup
        const bindGroup = device.createBindGroup({
            layout: bindGroupLayout,
            entries: [
                {//uniform buffer
                    binding: 0,
                    resource: {
                        buffer: uniformBuffer
                    }
                },
                {//imageBuffer
                    binding: 1,
                    resource: {
                        buffer: imageBuffer
                    }
                },
                {//accum buffer
                    binding: 2,
                    resource: {
                        buffer: accumBuffer
                    }
                }
            ]
        });

        //for later use - stored in buffers
        this.buffers.uniformBuffer = uniformBuffer;
        this.buffers.imageBuffer = imageBuffer;
        this.buffers.readBuffer = readBuffer;
        this.buffers.accumBuffer = accumBuffer;

        //for later use - stored in info
        this.info.device = device;
        this.info.bindGroup = bindGroup;
        this.info.bindGroupLayout = bindGroupLayout;
        this.info.pipelineLayout = device.createPipelineLayout({bindGroupLayouts: [bindGroupLayout]});
    }

    //wgpu compile the shader
    //takes as input the user "snippet" of code
    async compileShader(code) {
        //get necessary webGPU objects
        const device = this.info.device;

        //create and set compute pipeline
        this.info.computePipeline = await device.createComputePipeline({
            layout: this.info.pipelineLayout,
            compute: {
                module: device.createShaderModule({code: this.getShaderCode(code)}),
                entryPoint: "main"
            }
        });
    }

    //turns the input "snippet" of code into something ready for the compiler
    getShaderCode(code) {
        //split user code
        let split = code.split("//Code:");
        return this.info.code.above + split[0] + this.info.code.below + split[1];
    }


    //when canvas size is adjusted, the buffer size must be adjusted as well
    async resize(size) {
        //clear existing accum buffer it is exists
        if (this.buffers.accumBuffer) {
            this.buffers.accumBuffer.destroy();
        }
        //clear existing image buffer if it exists
        if (this.buffers.imageBuffer) {
            this.buffers.imageBuffer.destroy();
        }
        //clear existing read buffer if it exists
        if (this.buffers.readBuffer) {
            this.buffers.readBuffer.destroy();
        }

        //NOTE: this should probably be standardized - some use .width, some use .canvasX, some .canvasWidth
        this.calculateGroupSize(size.width, size.height);

        //get device
        const device = this.info.device;

        //recreate accum buffer
        const accumBuffer = device.createBuffer({
            size: this.info.imageBufferSize,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
        });

        //recreate image buffer
        const imageBuffer = device.createBuffer({
            size: this.info.imageBufferSize,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
        });

        //recreate read buffer
        const readBuffer = device.createBuffer({
            size: this.info.imageBufferSize,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
        });

        //recreate bind group
        const bindGroup = await device.createBindGroup({
            layout: this.info.bindGroupLayout,
            entries: [
                {//uniform buffer
                    binding: 0,
                    resource: {
                        buffer: this.buffers.uniformBuffer
                    }
                },
                {//imageBuffer
                    binding: 1,
                    resource: {
                        buffer: imageBuffer
                    }
                },
                {//accum buffer
                    binding: 2,
                    resource: {
                        buffer: accumBuffer
                    }
                }
            ]
        });

        //set to new bindgroup
        this.info.bindGroup = bindGroup;

        //reset buffers for copying
        this.buffers.accumBuffer = accumBuffer;
        this.buffers.imageBuffer = imageBuffer;
        this.buffers.readBuffer = readBuffer;
    }

    //should be called every frame
    async updateUniforms(flexArr) {
        let arr = flexArr;
        
        const device = this.info.device;

        //create accesible buffer
        let temp = device.createBuffer({
            mappedAtCreation: true,
            size: this.info.uniformBufferSize,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
        });

        //create accesible array
        let tempArr = new DataView(temp.getMappedRange());

        //setting values
        let currOffset = 0;

        //actually set values
        for (var x in arr) {
            //curr element of array
            let curr = arr[x];

            let alignOffset = 0;
            //find align offset
            switch(curr.dim) {
                case 2:
                    alignOffset = currOffset % 2;
                    break;
                case 3:
                    alignOffset = (4 - (currOffset % 4)) % 4;
                    break;
                case 4:
                    alignOffset = (4 - (currOffset % 4)) % 4;
                    break;
            }

            //align set point to required offset
            //currOffset is by four bytes, ie 1 fits a f32/u32/i32
            currOffset += alignOffset;

            //actually set values
            for (var y = 0; y < curr.dim; y++) {
                switch (curr.type) {
                    case "i32":
                        tempArr.setInt32(currOffset * 4, parseInt(curr.val[y]), true);
                        break;
                    case "f32":
                        tempArr.setFloat32(currOffset * 4, parseFloat(curr.val[y]), true);
                        break;
                    case "u32":
                        tempArr.setUint32(currOffset * 4, parseInt(curr.val[y]), true);
                        break;
                }
                currOffset += 1;
            }
        }

        const commandEncoder = device.createCommandEncoder();

        //IMPORTANT
        temp.unmap();

        //actual copy
        commandEncoder.copyBufferToBuffer(temp, 0, this.buffers.uniformBuffer, 0, this.info.uniformBufferSize);
        
        const commands = commandEncoder.finish();

        //submit commands
        device.queue.submit([commands]);
    }

    async render() {
        //get vars
        const device = this.info.device;

        //command interface
        const commandEncoder = device.createCommandEncoder();
        //render pass
        const passEncoder = commandEncoder.beginComputePass();

        //configure pass
        passEncoder.setPipeline(this.info.computePipeline);
        //set bind/buffer groups
        passEncoder.setBindGroup(0, this.info.bindGroup);

        //dispatch work groups based off screen size
        passEncoder.dispatchWorkgroups(
            Math.ceil(this.info.groupsX / 16),
            Math.ceil(this.info.groupsY / 16)
        );

        passEncoder.end();

        commandEncoder.copyBufferToBuffer(this.buffers.imageBuffer, 0, this.buffers.readBuffer, 0, this.info.imageBufferSize);
        
        //finish/submit commands
        const gpuCommands = commandEncoder.finish();
        await device.queue.submit([gpuCommands]);
        
        await this.buffers.readBuffer.mapAsync(GPUMapMode.READ);

        const readBuffer = this.buffers.readBuffer.getMappedRange();

        //readable, cpu-side buffer
        let arr = new Float32Array(readBuffer);
        
        //trim down to actual screen width
        let returned = await this.getTrimmedArray(arr);

        //show user the depth under the cursor
        const depthShower = document.querySelector(".depth");
        //depthShower.innerHTML = "depth: " + arr[(this.params.guiValues.mouseX + this.params.guiValues.mouseY * this.info.groupsX) * 4 + 3];
        
        this.params.guiValues.depth = arr[(this.params.guiValues.mouseX + this.params.guiValues.mouseY * this.info.groupsX) * 4 + 3];

        //required unmap
        this.buffers.readBuffer.unmap();

        return returned;
    }

    //trims wider image (from workgroup size being 16) to target canvas image
    async getTrimmedArray(arr) {
        //size of target (trimmed) array
        let imageX = this.params.canvasX;
        let imageY = this.params.canvasY;

        //size of actual (buffer) array
        let bufferX = this.info.groupsX;
        let bufferY = this.info.groupsY;

        //created return image, suitable for canvas
        let buf = new ArrayBuffer(bufferX * bufferY * 4 * Uint8ClampedArray.BYTES_PER_ELEMENT);
        let returned = new Uint8ClampedArray(buf);

        //big loop
        for (let y = 0; y < bufferY; y++) {
            for (let x = 0; x < bufferX; x++) {
                const i = (y * bufferX + x) * 4;  
                returned[i] = arr[(x + y * bufferX) * 4] * 255;
                returned[i + 1] = arr[(x + y * bufferX) * 4 + 1]  * 255;
                returned[i + 2] = arr[(x + y * bufferX) * 4 + 2]  * 255;
                returned[i + 3] = 255;  
            }
        }

        return returned;
    }

    //converts flex array {dim : u32, type : "i32/u32/f32", val: []}
    flexArrToBuffer(arr) {
        //get array length
        let temp = new ArrayBuffer( Math.floor(this.flexArrByteLength(arr)));

        let returned = new DataView(temp);

        let currOffset = 0;

        //actually set values
        for (var x in arr) {
            //curr element of array
            let curr = arr[x];

            let alignOffset = 0;
            //find align offset
            switch(curr.dim) {
                case 2:
                    alignOffset = currOffset % 2;
                    break;
                case 3:
                    alignOffset = (4 - (currOffset % 4)) % 4;
                    break;
                case 4:
                    alignOffset = (4 - (currOffset % 4)) % 4;
                    break;
            }

            //align set point to required offset
            //currOffset is by four bytes, ie 1 fits a f32/u32/i32
            currOffset += alignOffset;

            //actually set values
            for (var y = 0; y < curr.dim; y++) {
                switch (curr.type) {
                    case "i32":
                        returned.setInt32(currOffset * 4, parseInt(curr.val[y]), true);
                        break;
                    case "f32":
                        returned.setFloat32(currOffset * 4, parseFloat(curr.val[y]), true);
                        break;
                    case "u32":
                        returned.setUint32(currOffset * 4, parseInt(curr.val[y]), true);
                        break;
                }
                currOffset += 1;
            }
        }
        return returned;
    }

    //byte length of flex arr - used to determine buffer size
    flexArrByteLength(arr) {
        let byteLength = 0;

        //find byte length of buffer
        for (var x in arr) {
            let curr = arr[x];

            //determine bytes needed to store element - includes offset
            switch(curr.dim) {
                case 1:
                    //vec1 has simple alignment
                    byteLength += 4;
                    break;
                case 2:
                    //vec2's are aligned to 8 bits
                    if (byteLength % 8 == 0) {
                        byteLength += 8;
                        break;
                    }
                    byteLength += 12;
                    break;
                case 3:
                    //vec3's are aligned to 16 bits
                    if (byteLength % 16 == 0) {
                        byteLength += 12;
                        break;
                    }
                    //adjust alignment
                    byteLength = byteLength + 16 - (byteLength % 16);
                    byteLength += 12;
                    break;
                case 4:
                    //vec4's are aligned to 16 bits
                    if (byteLength % 16 == 0) {
                        byteLength += 16;
                        break;
                    }
                    byteLength = byteLength + 16 - (byteLength % 16);
                    byteLength += 16;
                    break;
            }
        }
        return byteLength;
    }
}