#version 300 es

precision highp float;
precision highp usampler2D;
precision highp isampler2D;
precision highp sampler2DArray;
precision highp sampler2D;

//output of shader
out vec4 outColor;

//uniforms
//whether or not to reproject
uniform int u_reproject;
//the size of the screen
uniform ivec2 u_screensize;
//atrous u_offsets
uniform ivec2[25] u_offset;
//if we are on the last atrous
uniform int u_last;
//the current atrous step we are on
uniform int u_steps;

//the raw value
uniform sampler2D u_color1;
//the world position of the current pixel
uniform sampler2D u_position1;
//the normal (and other info) of the current pixel
uniform sampler2D u_normal1;
//the number of samples
uniform usampler2D u_samples1;
//albedo
uniform sampler2D u_albedo;

vec3 acesGamma(vec3 x);

void main() {
    ivec2 pos = ivec2(gl_FragCoord.xy);
  
    float kernel[25];
    kernel[0] = 1.0/256.0;
    kernel[1] = 1.0/64.0;
    kernel[2] = 3.0/128.0;
    kernel[3] = 1.0/64.0;
    kernel[4] = 1.0/256.0;
    
    kernel[5] = 1.0/64.0;
    kernel[6] = 1.0/16.0;
    kernel[7] = 3.0/32.0;
    kernel[8] = 1.0/16.0;
    kernel[9] = 1.0/64.0;
    
    kernel[10] = 3.0/128.0;
    kernel[11] = 3.0/32.0;
    kernel[12] = 9.0/64.0;
    kernel[13] = 3.0/32.0;
    kernel[14] = 3.0/128.0;
    
    kernel[15] = 1.0/64.0;
    kernel[16] = 1.0/16.0;
    kernel[17] = 3.0/32.0;
    kernel[18] = 1.0/16.0;
    kernel[19] = 1.0/64.0;
    
    kernel[20] = 1.0/256.0;
    kernel[21] = 1.0/64.0;
    kernel[22] = 3.0/128.0;
    kernel[23] = 1.0/64.0;
    kernel[24] = 1.0/256.0;

    float fac = pow(2., -float(u_steps));

    float stepwidth = abs(float(u_offset[6].x));

    vec4 sum = vec4(0.);
    float c_phi = 10.;
    float n_phi = 1.;
    float p_phi = 1.;

    vec4 posnormal = texelFetch(u_position1, pos, 0);

    vec4 color = texelFetch(u_color1, pos, 0);

    vec3 normal = vec3(0.);
    
    if (posnormal.a == .25) {
        normal.x = 1.;
    } else if(posnormal.a == .5) {
        normal.y = 1.;
    } else if(posnormal.a == 1.) {
        normal.z = 1.;
    } else if (posnormal.a == 0.) {
        outColor = vec4(color.xyz, 1.);
        return;
    }

    float cum_w = 0.;

    for (int i = 0; i < 25; i++) {
        ivec2 uv = pos + u_offset[i];

        vec4 colorTemp = texelFetch(u_color1, uv, 0);
        vec4 t = color - colorTemp;

        if (colorTemp == vec4(0.)) {
            continue;
        }

        float dist2 = dot(t, t);

        float c_w = min(exp(-(dist2) / c_phi), 1.);

        vec4 posnormalTemp = texelFetch(u_position1, uv, 0);

        if (posnormalTemp.a == 0.) {
            continue;
        };

        vec3 normalTemp = vec3(0.);

        if (posnormalTemp.a == .25) {
            normalTemp.x = 1.;
        } else if(posnormalTemp.a == .5) {
            normalTemp.y = 1.;
        } else if(posnormalTemp.a == 1.) {
            normalTemp.z = 1.;
        }

        vec3 t3 = normal - normalTemp;

        dist2 = max(dot(t3, t3), 0.);

        float n_w = min(exp(-(dist2) / n_phi), 1.);

        t3 = posnormal.xyz - posnormalTemp.xyz;

        dist2 = dot(t3, t3);

        float p_w = min(exp(-(dist2)/p_phi), 1.);

        float weight =    n_w * p_w;

        sum += colorTemp * weight * kernel[i];

        cum_w += weight * kernel[i];
    }


    if (u_last > 0) {
        vec4 albedo = texelFetch(u_albedo, pos, 0);
        //should be optimized by moving this up front ??
        if (albedo.a == 0.) {
            outColor = vec4((sum / cum_w).xyz * texelFetch(u_albedo, pos, 0).xyz, 1.);
        } else {
            outColor = vec4(albedo.xyz, 1.);
        }
        return;
    }
    outColor = vec4((sum / cum_w).xyz, 1.);
   
    
    /*vec4 sum = vec4(0.);

    vec4 position = texelFetch(u_position1, pos, 0);
    float normal = position.a;

    if (position.a == 0.) {
        outColor = vec4(acesGamma(texelFetch(u_color1, pos, 0).xyz), 1.);
        return;
    }

    int size = 3;

    int div = 0;

    float maxlength = 1.;

    for (int i = -size; i < size + 1; i++) {
        for (int y  = -size; y < size + 1; y++) {
            vec4 position2 = texelFetch(u_position1, pos + ivec2(i, y), 0);
            float normal2 = position2.a;
            if (length(position2 - position) < maxlength && normal == normal2) {
                sum += texelFetch(u_color1, pos + ivec2(i, y), 0);
                div++;
            }
        }
    }

    outColor = vec4(((sum / float(div)).xyz), 1.);*/
    
}

vec3 acesGamma(vec3 x) {
    //perform aces and gamma color correction
    return pow(clamp((x * (x * 2.51 + .03)) / (x * (2.43 * x + .59) + .14), vec3(0.), vec3(1.)), vec3(1. / 2.2));
}

/*
    //median blur:

    int width = 2;

    int tot = (2 * width + 1) * (2 * width + 1);
    int amt = 0;

    float arrayR[30];
    float arrayG[30];
    float arrayB[30];

    vec4 position = texelFetch(u_position1, pos, 0);

    bool flag = true;

    for (int i = 0; i < tot; i++) {
        ivec2 opos = pos + ivec2((i % (2 * width + 1)) - width, (i / (2 * width + 1)) - width);
        vec3 curColor = texelFetch(u_color1, opos, 0).xyz;

        vec4 curPos = texelFetch(u_position1, opos, 0);

        if (length(curPos.xyz - position.xyz) < 1. && curPos.a == position.a) {
            arrayR[amt] = curColor.x;
            arrayG[amt] = curColor.y;
            arrayB[amt] = curColor.z;
            amt++;
        }  
    }

    for (int i = 0; i < amt; i++) {
        float rmin = arrayR[i];
        for (int r = i + 1; r < amt; r++) {
            float check = arrayR[r];
            if (rmin > check) {
                arrayR[i] = check;
                arrayR[r] = rmin;
                rmin = check;
            }
        }
        float gmin = arrayG[i];
        for (int g = i + 1; g < amt; g++) {
            float check = arrayG[g];
            if (gmin > check) {
                arrayG[i] = check;
                arrayG[g] = gmin;
                gmin = check;
            }
        }
        float bmin = arrayB[i];
        for (int b = i + 1; b < amt; b++) {
            float check = arrayB[b];
            if (bmin > check) {
                arrayB[i] = check;
                arrayB[b] = bmin;
                bmin = check;
            }
        }
    }

    outColor = vec4(arrayR[amt / 2], arrayG[amt / 2], arrayB[amt /2], 1.);
    if (amt == 0) {
        outColor = vec4(1., 0., 0., 1.);
    }
    return;



    vec4 sum = vec4(0.);
    float c_phi = 2.;
    float n_phi = 1.;
    float p_phi = 1.;

    vec4 posnormal = texelFetch(u_position1, pos, 0);
    
    vec4 color = texelFetch(u_color1, pos, 0);

    vec3 normal = vec3(0.);
    
    if (posnormal.a == .25) {
        normal.x = 1.;
    } else if(posnormal.a == .5) {
        normal.y = 1.;
    } else if(posnormal.a == 1.) {
        normal.z = 1.;
    }

    float cum_w = 0.;

    int size = 15;

    for (int x = -size; x < size + 1; x++) {
        for (int y = -size; y < size + 1; y++) {
            ivec2 uv = pos + ivec2(x, y);

            vec4 colorTemp = texelFetch(u_color1, uv, 0);
            vec4 t = color - colorTemp;

            float dist2 = dot(t, t);

            float c_w = min(exp(-(dist2) / c_phi), 1.);

            vec4 posnormalTemp = texelFetch(u_position1, uv, 0);

            vec3 normalTemp = vec3(0.);

            if (posnormalTemp.a == .25) {
                normalTemp.x = 1.;
            } else if(posnormalTemp.a == .5) {
                normalTemp.y = 1.;
            } else if(posnormalTemp.a == 1.) {
                normalTemp.z = 1.;
            }

            vec3 t3 = normal - normalTemp;

            dist2 = max(dot(t3, t3), 0.);

            float n_w = min(exp(-(dist2) / n_phi), 1.);

            t3 = posnormal.xyz - posnormalTemp.xyz;

            dist2 = dot(t3, t3);

            float p_w = min(exp(-(dist2)/p_phi), 1.);

            float weight = c_w * n_w * p_w;

            sum += colorTemp * weight;

            cum_w += weight;
        }
    }

    outColor = vec4((sum / cum_w).xyz * .9, 1.);
*/