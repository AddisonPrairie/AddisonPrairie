#version 300 es

precision highp float;
precision highp usampler2D;
precision highp isampler2D;
precision highp sampler2DArray;

//output of shader
layout(location=0) out vec4 outColor;
layout(location=1) out vec4 outPosition;
layout(location=2) out uint outSamples;
layout(location=3) out vec4 outAlbedo;


//uniforms

//screen resolution
uniform ivec2 u_screensize;
//forward (view) vector
uniform vec3 u_forward;
//right (view) vector
uniform vec3 u_right;
//position
uniform vec3 u_position;
//stores voxel states
uniform usampler2D u_states;
//because of texture width limitations, the width of the texture (has to be rectangular)
uniform int u_statestexoffset;
//blue noise
uniform sampler2DArray u_bluenoise;
//frames
uniform int u_frames;


//last frame camera information
uniform vec3 u_lPosition;
uniform vec3 u_lForward;
uniform vec3 u_lRight;

//last frame textures
uniform sampler2D u_lColor;
uniform sampler2D u_lWorldPosition;
uniform usampler2D u_samples;

//functions
void getRay(in vec2 fragCoord, inout vec3 pos, inout vec3 dir);
float march(in vec3 pos, in vec3 dir);
float DE(in vec3 pos);
uint getVal(int index);
bool intersect(in vec3 o, in vec3 dir, inout vec3 normal, inout float dist, inout ivec3 ipos);
vec3 getSample(in vec3 o, in vec3 dir);
float ao(vec3 o, vec3 norm, float radius);

bool flag = false;

float offset = 0.;

vec2 seed;

bool first = true;

vec4 position;

//hash
vec2 hash22(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973));
    p3 = p3 + dot(p3, p3.yzx+33.33);
    return fract((p3.xx+p3.yz)*p3.zy);
}

//get blue random number
vec2 rand2n() {
    seed += vec2(1., -1.);
    return hash22(seed);
    
    vec2 returned = texelFetch(u_bluenoise, ivec3(ivec2(gl_FragCoord.xy) % ivec2(128, 128), u_frames % 16), 0).xy;

    returned = mod((returned + offset), 1.);

    offset += 1.61803398875;

    return (returned);
}

//color correction
vec3 acesGamma(vec3 x) {
    //perform aces and gamma color correction
    return pow(clamp((x * (x * 2.51 + .03)) / (x * (2.43 * x + .59) + .14), vec3(0.), vec3(1.)), vec3(1. / 2.2));
}

//fetches value from state array
uint getVal(int index) {
    return texelFetch(u_states, ivec2(index % 4680, index / 4680), 0).r;
}

void main() {
    //original ray position/direction
    vec3 pos;
    vec3 dir;

    seed = gl_FragCoord.xy  * max(.01, abs(sin(float(1 + u_frames))));

    getRay(gl_FragCoord.xy, pos, dir);

    vec3 color = getSample(pos, dir);

    if (position.a == 0.) {
        outColor = vec4(color, 1.);
        return;
    }

    //reproject from last frame
    ivec2 spos = ivec2(gl_FragCoord.xy);

    vec3 lastCenter = u_lPosition + (u_lForward);

    vec3 lDirection = normalize(u_lPosition - position.xyz);

    //https://www.cs.princeton.edu/courses/archive/fall00/cs426/lectures/raycast/sld017.htm
    vec3 lScreenPlane = position.xyz - lastCenter - lDirection * (dot(position.xyz, u_lForward) - dot(lastCenter, u_lForward)) / (dot(lDirection, u_lForward));
    
    vec2 lSSpace = vec2(dot(lScreenPlane, u_lRight) , dot(normalize(cross(u_lForward, u_lRight)), lScreenPlane));

    ivec2 lpos = ivec2(lSSpace * float(u_screensize.y) + .5 * vec2(u_screensize));

    vec3 accum = color;
    uint samples = 1u;

    vec4 lastPixel = texelFetch(u_lWorldPosition, lpos, 0);

    bool isValid =  lastPixel.a == position.a && length(lastPixel.xyz - position.xyz) < 1. && 0 <= lpos.x && lpos.x <= u_screensize.x + 1 && 0 <= lpos.y && lpos.y <= u_screensize.y + 1;

    uint numSamples = 1u;

    if (isValid) {
        vec3 lastColor = texelFetch(u_lColor, lpos, 0).xyz;
        numSamples += min(texelFetch(u_samples, lpos, 0).r, 32u);

        color = mix(lastColor, color, 1. / float(numSamples));    
    } 
    
   
    outSamples = numSamples;
    outColor = vec4(color,  1.);
    return;

}

//convert pixel coordinate to a camera ray
void getRay(in vec2 fragCoord, inout vec3 pos, inout vec3 dir) {
    //switch to uniform later
    float scale = 1.;
    //relative position of camera
    vec2 sspace = (gl_FragCoord.xy - .5 * vec2(u_screensize)) / vec2(u_screensize.y);
    //out position
    pos = u_position  + scale * (u_forward + normalize(cross(u_forward, u_right)) * sspace.y + u_right * sspace.x);
    dir = normalize(pos - u_position);
}

//intersects a cube from the inside of the cube
vec3 cube(vec3 o, vec3 d, vec3 iDir, float scale) {
    return - (sign(d) * (o - scale * .5) - scale * .5) * iDir;
}

int newstate(float scale, uint offset, vec3 pos, uint amt) {
    //if we are at the highest voxel level
    if (scale == 256.) {
        if (pos != vec3(0.)) {
            return 0;
        }

        return 1;
    }

    if ( pos.x + pos.y >= pos.z  && hash22(pos.xy - scale * vec2(pos.z, pos.x)).x < .93) {
        if (scale == 1.) {
            return 2;
        }
        return 1;
    }
    return 0;
}

//ray-scene intersection function
bool intersect(in vec3 o, in vec3 d, inout vec3 normal, inout float dist, inout ivec3 ipos) {
    float scale = 256.;

    int iterations = 400;

    vec3 pos = o;

    //for DDA
    vec3 iDir = 1. / max(abs(d), vec3(.001));

    //initial intersection, move ray to edge of cube
    vec3 t0 = -o * iDir * sign(d);
    vec3 t1 = (vec3(scale) - o) * iDir * sign(d);

    vec3 mins = min(t0, t1);
    vec3 maxs = max(t0, t1);

    vec2 t = vec2(max(mins.x, max(mins.y, mins.z)), min(maxs.x, min(maxs.y, maxs.z)));

    if (t.x > t.y || t.y < 0.) {
        if (first) {
            outPosition = vec4(0.);
            position = vec4(0.);
            first = false;
        }
        return false;
    }

    //running distance
    dist = max(0., t.x - .01);
    pos += d * dist;
    
    bool exitoct = false;

    vec3 mask;

    //position within the voxel
    vec3 relative = mod(pos, scale);
    //position in the grid
    vec3 floored = pos - relative;

    int i;

    bool hit = false;

    //tracks the offset that voxel data is stored in memory
    uint offset = -1u;
    uint recur = 0u;
    uint amt = 1u;

    //adjust for floating point errors
    t.y = t.y - .001;

    for (i = 0; i < iterations; i++) {
        //if we have left the cube
        if (dist > t.y) {
            break;
        }
        //if we need to go up a level
        if (exitoct) {
            //new floored
            vec3 newfloored = floor(floored/(scale * 2.)) * (scale * 2.);
            relative += floored - newfloored;
            floored = newfloored;

            //update offset
            amt >>= 3;
            offset -= amt;
            recur--;

            scale *= 2.;

            //check if we need to exit again, better version by:
            //https://www.shadertoy.com/view/4sVfWw
            exitoct = (scale < 256.) && (abs(dot(mod(floored/scale+0.5,2.0)-1.0+mask*sign(d)*0.5,mask))<0.1);
            continue;
        }

        //we need to actually get the voxel state
        //int voxelstate = state(scale, floored);
        int voxelstate = newstate(scale, offset, floored, amt);

        if (voxelstate == 1) {
            scale *= .5;

            if (scale < 1.) {
                break;
            }

            //find the next octant
            vec3 octmask = step(vec3(scale), relative);
            floored += octmask * scale;
            relative -= octmask * scale;

            //update offset
            offset += amt;
            amt <<= 3;
            recur++;

            continue;
        }

        if (voxelstate == 2) {
            hit = true;
            break;
        }

        vec3 hits = cube(relative, d, iDir, scale);

        mask = vec3(lessThan(hits.xyz, min(hits.yzx, hits.zxy)));

        float newdist = dot(mask, hits);

        dist += newdist;

        //move forward but mod it
        relative += d * newdist - mask * sign(d) * scale;
        vec3 newfloored = floored + mask * sign(d) * scale;
        
        //check if we need to go up a level
        exitoct = (scale < 256.) && (floor(newfloored / scale * .5 + .25)) != floor(floored / scale * .5 + .25);

        floored = newfloored;

        normal = mask;
    }

    if (!hit) {
        normal = vec3(0);
    }

    normal *= -sign(d);

    if (first == true) {
        position = vec4(o + d * dist, dot(abs(normal), vec3(.25, .5, 1.)));
        first = false;
    }

    ipos = ivec3(floored);

    return hit;
}

//get a random sample in a hemisphere
vec3 getSampleBiased(vec3 d, vec3 o1, vec3 o2, float power) {
    vec2 r = rand2n();
    r.x = r.x * 2. * 3.1415926535897932;
    r.y = pow(r.y, 1. / (power + 1.));
    float oneminus = sqrt(1. - r.y * r.y);

    return cos(r.x) * oneminus * o1 + sin(r.x) * oneminus * o2 + r.y * d;
}

//gets orthonormal vector
vec3 ortho(vec3 v) {
    if (abs(v.x) > abs(v.y)) {
        return vec3(-v.y, v.x, 0.);
    }
    return vec3(0., -v.z, v.y);
}

//http://blog.hvidtfeldts.net/index.php/2015/01/path-tracing-3d-fractals/
vec3 getConeSample(vec3 dir, float extent) {
        // Formula 34 in GI Compendium
	dir = normalize(dir);
	vec3 o1 = normalize(ortho(dir));
	vec3 o2 = normalize(cross(dir, o1));
	vec2 r =  rand2n();
	r.x=r.x*2.*3.1415926535897932;
	r.y=1.0-r.y*extent;
	float oneminus = sqrt(1.0-r.y*r.y);
	return cos(r.x)*oneminus*o1+sin(r.x)*oneminus*o2+r.y*dir;
}

vec3 pathtrace(vec3 o, vec3 d);

void getMaterial(ivec3 ipos, inout vec3 albedo, inout vec3 emissive) {
    if (false && hash22(vec2(ivec2(ipos.x + ipos.y * 2, ipos.z))).x > .99) {
        vec2 r1 = hash22(vec2(ivec2(ipos.x - ipos.y, ipos.z + ipos.x)));
        emissive =  5. * vec3(1.);
        albedo =   1. * vec3(1.);
        return;
    }

    vec2 r2 = hash22(vec2(ivec2(ipos.z + ipos.y, ipos.y + ipos.x )));

    
    
    albedo = (r2.y * .1 + .9 ) * (r2.x > .5 ? vec3(.45, .6, .7) : vec3(1., 1., 1.));
}

//get the color of a pixel
vec3 getSample(in vec3 o, in vec3 d) {
    vec3 pos = o;
    vec3 dir = d;
    vec3 normal;
    ivec3 ipos;

    float dist = 1.;

    bool hit = intersect(pos, dir, normal, dist, ipos);

    vec3 sky = vec3(0.5);

    pos = pos + dir * dist + .0001 * normal;

    vec3 o1 = normalize(ortho(normal));
    vec3 o2 = normalize(cross(normal, o1));

    dir = getSampleBiased(normal, o1, o2, 1.);


    outPosition = vec4(pos, dot(abs(normal), vec3(.25, .5, 1.)));
    if (hit == false) {
        outPosition.a = 0.;
        outAlbedo = vec4(sky, 0.);
        return vec3(1.);
    }

    //for getting the material
    vec3 mAlbedo;
    vec3 mEmissive;

    getMaterial(ipos, mAlbedo, mEmissive);

    //store whether this is an emissive surface
    outAlbedo = vec4(mAlbedo, mEmissive == vec3(0.) ? 0. : 1.);

    int bounces = 1;

    vec3 returned = vec3(0.);
    vec3 color = vec3(1.);
    vec3 direct = vec3(0.);
    vec3 sunLight = vec3(10000., 9000, 9000);

    float time = float(u_frames) / 500. + 3.14/2.;

    vec3 sunDirection = normalize(vec3(cos(time), sin(time), 1.));

    vec3 sunDir = getConeSample(sunDirection, 1e-5);

    float sunHit =  dot(normal, sunDir);

    if (sunHit > 0. && !intersect(pos, sunDir, normal, dist, ipos)) {
        direct += color * sunLight * 1E-5;
    }

    for (int i = 0; i < bounces; i++) {
        bool hit = intersect(pos, dir, normal, dist, ipos);

        if (hit) {
            o1 = normalize(ortho(normal));
            o2 = normalize(cross(normal, o1));

            pos = pos + dir * dist + .0001 * normal;
            dir = getSampleBiased(normal, o1, o2, 1.);

            //for getting the material
            vec3 mAlbedo;
            vec3 mEmissive;

            getMaterial(ipos, mAlbedo, mEmissive);

            returned += mEmissive * color;
            color *= mAlbedo;

            sunDir = getConeSample(sunDirection, 1e-5);

            sunHit =  dot(normal, sunDir);

            if (sunHit > 0. && !intersect(pos, sunDir, normal, dist, ipos)) {
                direct += color * sunLight * 1E-5;
            }
        } else {
            returned += color * sky;
            break;
        }
    }

    return direct + returned;
}

/*
//get the color of a pixel
vec3 getSample(in vec3 o, in vec3 d) {
    vec3 pos = o;
    vec3 dir = d;
    vec3 normal;
    ivec3 ipos;

    float dist = 1.;

    bool hit = intersect(pos, dir, normal, dist, ipos);

    vec3 sky = vec3(0.5);

    pos = pos + dir * dist + .0001 * normal;

    vec3 o1 = normalize(ortho(normal));
    vec3 o2 = normalize(cross(normal, o1));

    dir = getSampleBiased(normal, o1, o2, 1.);


    outPosition = vec4(pos, dot(abs(normal), vec3(.25, .5, 1.)));
    if (hit == false) {
        outPosition.a = 0.;
        outAlbedo = vec4(sky, 0.);
        return vec3(1.);
    }

    //for getting the material
    vec3 mAlbedo;
    vec3 mEmissive;

    getMaterial(ipos, mAlbedo, mEmissive);

    //store whether this is an emissive surface
    outAlbedo = vec4(mAlbedo, mEmissive == vec3(0.) ? 0. : 1.);

    int bounces = 2;

    vec3 returned = vec3(0.);//mEmissive;
    vec3 color = vec3(1.);

    for (int i = 0; i < bounces; i++) {
        bool hit = intersect(pos, dir, normal, dist, ipos);

        if (hit) {
            o1 = normalize(ortho(normal));
            o2 = normalize(cross(normal, o1));

            pos = pos + dir * dist + .0001 * normal;
            dir = getSampleBiased(normal, o1, o2, 1.);

            //for getting the material
            vec3 mAlbedo;
            vec3 mEmissive;

            getMaterial(ipos, mAlbedo, mEmissive);

            //vec3 emissive = hash22(vec2(ivec2(ipos.x + ipos.y * 2, ipos.z))).x > .5 ?  1. * vec3(.9, .8, .6) : vec3(0.);

            returned += mEmissive * color;
            color *= mAlbedo;

            //color *= hash22(vec2(ivec2(ipos.z, ipos.y + ipos.x))).x > .5 ? vec3(1., 0.5, 0.) : vec3(1., 1., 1.);
        } else {
            returned += color * sky; //sky
            break;
        }
    }

    return returned;
}
*/