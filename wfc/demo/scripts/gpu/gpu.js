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
    boundsX: i32,
    boundsY: i32,
    boundsZ: i32
    

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
    hit : bool,
    mappos : vec3<i32>
}

@group(0) @binding(0) var<storage, read> uniforms : uniforms_type;
@group(0) @binding(1) var<storage, read_write> result : array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> accum : array<vec4<f32>>;
@group(0) @binding(3) var<storage, read> meshpointers : array<u32>;
@group(0) @binding(4) var<storage,read> triangles : array<vec3<f32>>;
@group(0) @binding(5) var<storage, read> types : array<i32>;
@group(0) @binding(6) var<storage, read> rotation : array<i32>;

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
    //if (uniforms.pathtrace > 0) {
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

        /*//stochastic depth of field
        var focalpoint = o.pos + o.dir * uniforms.focallength;
        screenpos += uniforms.aperture * srand2n();

        //recalculate ray origin, shifted by aperture
        o.pos = uniforms.position + uniforms.forward * uniforms.pinhole * uniforms.zoom + uniforms.zoom * (normalize(-cross(uniforms.right, uniforms.forward)) * screenpos.y + uniforms.right * screenpos.x); 
        o.dir = normalize(focalpoint - o.pos);*/

        var res = sampleDirect(o);

        //get color for current sample on current pixel
        var samplecolor = (vec3<f32>(res));
        
        samplecolor = min(samplecolor, vec3<f32>(1.));
        
        var final = setAccum(global_id, vec4<f32>(samplecolor, 1.));
        //final.xyz / final.a
        setResult(global_id, vec4<f32>(acesGamma(final.xyz / final.a), depth));
    /*} else { //regular render - not path traced
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
    } */
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

//intersection function
fn intersectFloor(r : ray) -> rayhit {
    var returned : rayhit;
    returned.hit = true;
    returned.dist = -r.pos.z / r.dir.z;
    returned.norm = vec3<f32>(0., 0., 1.);
    returned.pos = r.pos + r.dir * returned.dist;
    returned.mappos = vec3<i32>(returned.pos);
    return returned;
}

fn getVoxel(pos : vec3<i32>) -> i32 {
    if (!inBounds(pos)) {
        return 0;
    }

    var index = u32(pos.x + pos.y * uniforms.boundsX + pos.z * uniforms.boundsX * uniforms.boundsY);

    return types[index];
}

fn getRotation(pos : vec3<i32>) -> i32 {
    if (!inBounds(pos)) {
        return 0;
    }

    var index = u32(pos.x + pos.y * uniforms.boundsX + pos.z * uniforms.boundsX * uniforms.boundsY);

    return rotation[index];
}


fn inBounds(pos : vec3<i32>) -> bool {
    if (pos.x < 0 || pos.y < 0 || pos.z < 0) {
        return false;
    }

    if (pos.x >= uniforms.boundsX || pos.y >= uniforms.boundsY || pos.z >= uniforms.boundsZ) {
        return false;
    }

    return true;
}

fn zAxisRotate(theta : f32) -> mat3x3<f32> {
    var c = cos(theta);
    var s = sin(theta);

    return mat3x3<f32>(c, -s, 0., s, c, 0., 0., 0., 1.);
}

fn intersectVoxel(mappos : vec3<i32>, o1 : vec3<f32>, d1 : vec3<f32>) -> rayhit {
    var returned : rayhit;

    var curvoxel = getVoxel(mappos);

    var start = meshpointers[u32(curvoxel)];
    var end = meshpointers[u32(curvoxel) + 1u];

    var v0 : vec3<f32>;
    var v1 : vec3<f32>;
    var v2 : vec3<f32>;

    var cvec : vec3<f32>;

    var det : f32;

    var eps = .001;

    var rot = getRotation(mappos);

    var rotMatrix = zAxisRotate(PI * f32(-rot + 2) / 2.);
    var invRot = zAxisRotate(PI * f32(rot + 2) / 2.);

    var o =  vec3<f32>(.5) + rotMatrix * (o1 - vec3<f32>(mappos) - vec3<f32>(.5));

    var d =  rotMatrix * (d1);

    var hit = false;
    var min_dist = 100000.;
    var hit_normal : vec3<f32>;

    for (var i = start; i < end; i = i + 3u) {
        v0 = triangles[i];
        v1 = triangles[i + 1u];
        v2 = triangles[i + 2u];

        var v0v1 = v1 - v0;
        var v0v2 = v2 - v0;

        var pvec = cross(d, v0v2);

        var det = dot(v0v1, pvec);

        if (abs(det) >= eps) {
            var invDet = 1. / det;

            var tvec = o - v0;

            var u = dot(tvec, pvec) * invDet;
            if (0. <= u && u <= 1.) {
                var qvec = cross(tvec, v0v1);
                var v = dot(d, qvec) * invDet;

                if (0. <= v && u + v <= 1.) {
                    var t = dot(v0v2, qvec) * invDet;
                    if (t < min_dist && t >= 0.) {
                        hit = true;
                        hit_normal = invRot * sign(det) * normalize(cross(v0v1, v0v2));
                        min_dist = t;
                    }
                }
            }
        }
    }

    if (hit) {
        returned.hit = true;
        returned.norm = (hit_normal);
        returned.dist = min_dist;
        if (first) {
            first = false;
            depth = min_dist;
        }
        returned.pos = o + d * min_dist;
    } else {
        returned.dist = 1000000.;
    }

    return returned;
}

fn intersect(r : ray) -> rayhit {
    var returned : rayhit;

    var bounds = intersectBounds(r);

    if (!bounds.hit) {
        returned.hit = false;
        if (r.dir.z < 0. && r.pos.z >= 0. && uniforms.floor > 0) {
            return intersectFloor(r);
        }
        return returned;
    }

    var pos = bounds.dist * r.dir + r.pos;

    var deltadist = abs(vec3<f32>(1.) / r.dir);

    var mappos = vec3<i32>(floor(pos + 0.));

    var raystep = vec3<i32>(sign(r.dir));
    
    var sidedist = (sign(r.dir) * (vec3<f32>(mappos) - pos) + (sign(r.dir) * .5) + .5) * deltadist;

    var mask : vec3<bool>;

    for (var i = 0; i < 500; i = i + 1) {
        if (!inBounds(mappos) && i > 3) {
            returned.hit = false;
            break;
        }

        //PURE VOXEL TEST
        if (true) {

            var ret = intersectVoxel(mappos, r.pos, r.dir);

            if (ret.hit) {
                returned.hit = true;
                returned.norm = ret.norm;
                returned.dist = ret.dist;
                returned.pos = r.pos + r.dir * ret.dist;
                returned.mappos = mappos;
                break;
            }
        } else {
            var curVoxel = getVoxel(mappos);

            if (curVoxel > 0) {
                var check = cubeIntersect(r, vec3<f32>(mappos));
                if (check.hit) {
                    return check;
                }
            } 
        }

        mask = (sidedist.xyz <= min(sidedist.yzx, sidedist.zxy));

        sidedist = sidedist + vec3<f32>(mask) * deltadist;

        mappos = mappos + vec3<i32>(mask) * raystep;
    }

    if (returned.hit == false) {
        if (r.dir.z < 0. && r.pos.z >= 0. && uniforms.floor > 0) {
            return intersectFloor(r);
        }
    }

    return returned;
}

fn cubeIntersect(r : ray, low : vec3<f32>) -> rayhit {
    var size = .8;

    var returned : rayhit;
    var invRay = vec3<f32>(1.) / r.dir;

    var t_odd = (low - r.pos) * invRay;
    var t_eve = (low + vec3<f32>(size) - r.pos) * invRay;

    var mins = min(t_odd, t_eve);
    var tmin = max(mins.x, max(mins.y, mins.z));
    
    var maxs = max(t_odd, t_eve);
    var tmax = min(maxs.x, min(maxs.y, maxs.z));

    if (tmax < 0.) {
        returned.hit = false;
        return returned;
    }

    if (tmin > tmax) {
        returned.hit = false;
        return returned;
    }

    var eps = .01;

    var relpos = r.pos + r.dir * tmin - low;
    
    var normal = vec3<f32>(0.);

    if ((relpos.z) > size - eps) {
        normal.z = 1.;
    }
    if (relpos.z < eps) {
        normal.z = -1.;
    }
    if ((relpos.x) > size - eps) {
        normal.x = 1.;
    }
    if (relpos.x < eps) {
        normal.x = -1.;
    }
    if ((relpos.y) > size - eps) {
        normal.y = 1.;
    }
    if (relpos.y < eps) {
        normal.y = -1.;
    }
    
    returned.pos = r.pos + r.dir * tmin;
    returned.hit = true;
    returned.dist = tmin + .001;
    returned.norm = normalize(normal);
    return returned;
}

fn intersectBounds(r : ray) -> rayhit {
    var returned : rayhit;

    if (inBounds(vec3<i32>(r.pos))) {
        returned.pos = r.pos;
        returned.hit = true;
        returned.dist = 0.;
        return returned;
    }

    var invRay = vec3<f32>(1.) / r.dir;

    var t_odd = - r.pos * invRay;
    var t_eve = (vec3<f32>(f32(uniforms.boundsX), f32(uniforms.boundsY), f32(uniforms.boundsZ)) - r.pos) * invRay;

    var mins = min(t_odd, t_eve);
    var tmin = max(mins.x, max(mins.y, mins.z));
    
    var maxs = max(t_odd, t_eve);
    var tmax = min(maxs.x, min(maxs.y, maxs.z));

    if (tmax < 0.) {
        returned.hit = false;
        return returned;
    }

    if (tmin > tmax) {
        returned.hit = false;
        return returned;
    }

    returned.pos = r.pos + r.dir * tmin;
    returned.hit = true;
    returned.dist = tmin + .001;
    return returned;
}

fn getColor(z : vec3<f32>) -> vec3<f32> {
    return vec3<f32>(.9);
}

fn getBackground(z : vec3<f32>) -> vec3<f32> {
    return vec3<f32>(.8);//vec3<f32>(102. / 255., 153. / 255., 204. / 255.);//mix(vec3<f32>(.5, .7, .6), vec3<f32>(1.), z.z);
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

        } else {//if we missed, modulate and return color by atmospheric light
            return color * getBackground(cur.dir);
        }
    }

    //return 0 if ray failed to find light source
    return vec3<f32>(0.);
}


fn sampleDirect(o : ray) -> vec3<f32> {
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
    info = {code: {}};

    //constructor to set params
    constructor(params) {
        this.params = params;
        //init
        this.init();
    }

    //calculates other paramaters, including number of groups, etc. called from constructor or reset
    init() {
        this.info.uniformBufferSize = this.flexArrByteLength(this.params.uniforms);
        console.log("HELO");
        console.log(this.params.uniforms);
        //calculate buffer size and number of work groups
        this.calculateGroupSize(this.params.canvasX, this.params.canvasY);
        //
        this.info.meshPointersBufferLength = this.params.meshPointersBufferLength;
        this.info.trianglesBufferLength = this.params.trianglesBufferLength;
        this.info.typesBufferLength = this.params.bounds.x * this.params.bounds.y * this.params.bounds.z;
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

    //fetches shader code, compiles, creates requisite buffers, etc.
    async prep() {
        console.log(navigator);
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

        //WFC-specific parts
        const meshPointersBuffer = device.createBuffer({
            size : this.info.meshPointersBufferLength * Uint32Array.BYTES_PER_ELEMENT,
            usage : GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
        });
    
        const trianglesBuffer = device.createBuffer({
            size : this.info.trianglesBufferLength * Float32Array.BYTES_PER_ELEMENT,
            usage : GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
        });
    
        const typesBuffer = device.createBuffer({
            size : this.info.typesBufferLength * Int32Array.BYTES_PER_ELEMENT,
            usage : GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
        });
    
        const rotBuffer = device.createBuffer({
            size : this.info.typesBufferLength * Int32Array.BYTES_PER_ELEMENT,
            usage : GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
        });

        
        console.log(this.info.uniformBufferSize);

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
                },
                {//mesh pointers buffer
                    binding: 3,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: {
                        type: "read-only-storage"
                    }
                },
                {//triangles buffer
                    binding: 4,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: {
                        type: "read-only-storage"
                    }
                },
                {//types buffer
                    binding: 5,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: {
                        type: "read-only-storage"
                    }
                },
                {//rotation buffer
                    binding: 6,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: {
                        type: "read-only-storage"
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
                },
                {
                    binding: 3,
                    resource: {
                        buffer: meshPointersBuffer
                    }
                },
                {
                    binding: 4,
                    resource: {
                        buffer: trianglesBuffer
                    }
                },
                {
                    binding: 5,
                    resource: {
                        buffer: typesBuffer
                    }
                },
                {
                    binding: 6,
                    resource: {
                        buffer: rotBuffer
                    }
                }
            ]
        });

        //for later use - stored in buffers
        this.buffers.uniformBuffer = uniformBuffer;
        this.buffers.imageBuffer = imageBuffer;
        this.buffers.readBuffer = readBuffer;
        this.buffers.accumBuffer = accumBuffer;
        this.buffers.meshPointersBuffer = meshPointersBuffer;
        this.buffers.trianglesBuffer = trianglesBuffer;
        this.buffers.typesBuffer = typesBuffer;
        this.buffers.rotBuffer = rotBuffer;

        //for later use - stored in info
        this.info.device = device;
        this.info.bindGroup = bindGroup;
        this.info.bindGroupLayout = bindGroupLayout;
        this.info.pipelineLayout = device.createPipelineLayout({bindGroupLayouts: [bindGroupLayout]});


        await this.compileShader();
    }

    //load meshes onto GPU, only needs to be done once
    loadMeshes(meshesArray, trisArray) {
        const device = this.info.device;

        let pointersBuffer = this.buffers.meshPointersBuffer;
        let trianglesBuffer = this.buffers.trianglesBuffer;

        let tempPointers = device.createBuffer({
            mappedAtCreation : true,
            size : meshesArray.length * Uint32Array.BYTES_PER_ELEMENT,
            usage : GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
        });
    
        let tempTris = device.createBuffer({
            mappedAtCreation : true,
            size : trisArray.length * Float32Array.BYTES_PER_ELEMENT,
            usage : GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
        });
    
        let pointersArr = new Uint32Array(tempPointers.getMappedRange());
        let trisArr = new Float32Array(tempTris.getMappedRange());
    
        pointersArr.set(meshesArray);
        trisArr.set(trisArray);
    
        tempPointers.unmap();
        tempTris.unmap();
    
        const commandEncoder = device.createCommandEncoder();
        
        commandEncoder.copyBufferToBuffer(tempPointers, 0, pointersBuffer, 0, meshesArray.length * Uint32Array.BYTES_PER_ELEMENT);
        commandEncoder.copyBufferToBuffer(tempTris, 0, trianglesBuffer, 0, trisArray.length * Float32Array.BYTES_PER_ELEMENT);
    
        const commands = commandEncoder.finish();
        
        device.queue.submit([commands]);
    }

    loadTypes(typesArray, rotArray) {
        let device = this.info.device;
    
        let typesBuffer = this.buffers.typesBuffer;
        let rotBuffer = this.buffers.rotBuffer;
    
        var size =  typesArray.length * Int32Array.BYTES_PER_ELEMENT;
    
        let tempTypes = device.createBuffer({
            mappedAtCreation : true,
            size : size,
            usage : GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
        });
    
        let tempRot = device.createBuffer({
            mappedAtCreation : true,
            size : size,
            usage : GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
        });
    
        let typesArr = new Uint32Array(tempTypes.getMappedRange());
        let rotArr = new Uint32Array(tempRot.getMappedRange());
    
        typesArr.set(typesArray);
        rotArr.set(rotArray);
    
        tempTypes.unmap();
        tempRot.unmap();
    
        const commandEncoder = device.createCommandEncoder();
    
        commandEncoder.copyBufferToBuffer(tempTypes, 0, typesBuffer, 0, size);
        commandEncoder.copyBufferToBuffer(tempRot, 0, rotBuffer, 0, size);
    
        const commands = commandEncoder.finish();
    
        device.queue.submit([commands]);
    }

    //wgpu compile the shader
    //takes as input the user "snippet" of code
    async compileShader() {
        //get necessary webGPU objects
        const device = this.info.device;

        //create and set compute pipeline
        this.info.computePipeline = await device.createComputePipeline({
            layout: this.info.pipelineLayout,
            compute: {
                module: device.createShaderModule({code: shaderCode}),
                entryPoint: "main"
            }
        });
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
                },
                {
                    binding: 3,
                    resource: {
                        buffer: this.buffers.meshPointersBuffer
                    }
                },
                {
                    binding: 4,
                    resource: {
                        buffer: this.buffers.trianglesBuffer
                    }
                },
                {
                    binding: 5,
                    resource: {
                        buffer: this.buffers.typesBuffer
                    }
                },
                {
                    binding: 6,
                    resource: {
                        buffer: this.buffers.rotBuffer
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

    //when canvas size is adjusted, the buffer size must be adjusted as well
    async resizeScene(bounds) {
        console.log(bounds);
        this.info.typesBufferLength = bounds.x * bounds.y * bounds.z;
        console.log();
        //clear existing accum buffer it is exists
        if (this.buffers.typesBuffer) {
            this.buffers.typesBuffer.destroy();
        }
        //clear existing image buffer if it exists
        if (this.buffers.rotBuffer) {
            this.buffers.rotBuffer.destroy();
        }

        //get device
        const device = this.info.device;

        const typesBuffer = device.createBuffer({
            size : this.info.typesBufferLength * Int32Array.BYTES_PER_ELEMENT,
            usage : GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
        });
    
        const rotBuffer = device.createBuffer({
            size : this.info.typesBufferLength * Int32Array.BYTES_PER_ELEMENT,
            usage : GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
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
                        buffer: this.buffers.imageBuffer
                    }
                },
                {//accum buffer
                    binding: 2,
                    resource: {
                        buffer: this.buffers.accumBuffer
                    }
                },
                {
                    binding: 3,
                    resource: {
                        buffer: this.buffers.meshPointersBuffer
                    }
                },
                {
                    binding: 4,
                    resource: {
                        buffer: this.buffers.trianglesBuffer
                    }
                },
                {
                    binding: 5,
                    resource: {
                        buffer: typesBuffer
                    }
                },
                {
                    binding: 6,
                    resource: {
                        buffer: rotBuffer
                    }
                }
            ]
        });

        //set to new bindgroup
        this.info.bindGroup = bindGroup;

        //reset buffers for copying
        this.buffers.typesBuffer = typesBuffer;
        this.buffers.rotBuffer = rotBuffer;
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
        let bufferX = this.info.groupsX;//this.params.canvasWidth + ((16 - (this.params.canvasWidth % 16)) % 16);
        let bufferY = this.info.groupsY;//this.params.canvasHeight + ((16 - (this.params.canvasWidth % 16)) % 16);

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