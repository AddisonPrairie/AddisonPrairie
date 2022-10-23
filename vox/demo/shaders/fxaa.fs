#version 300 es

precision highp float;
precision highp usampler2D;
precision highp isampler2D;
precision highp sampler2DArray;
precision highp sampler2D;

#define FXAA_REDUCE_MIN   (1.0/ 128.0)
#define FXAA_REDUCE_MUL   (1.0 / 8.0)
#define FXAA_SPAN_MAX     8.0

out vec4 outColor;


uniform sampler2D u_color;
uniform vec2 u_screensize;


vec2 hash22(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973));
    p3 = p3 + dot(p3, p3.yzx+33.33);
    return fract((p3.xx+p3.yz)*p3.zy);
}


//fast approximate anti aliasing
//https://github.com/mattdesl/glsl-fxaa/blob/master/fxaa.glsl
void main() {

    vec2 inverseP = 1. / u_screensize;

    //return fxaa(u_color, gl_FragCoord.xy, u_screensize, 
    //(gl_FragCoord.xy + vec2(-1., 1.)) * inverseVP, (gl_FragCoord.xy + vec2(1., 1.)) * inverseVP
    //(gl_FragCoord.xy + vec2(-1., -1.)) * inverseVP, (gl_FragCoord.xy + vec2(1., -1.)) * inverseVP,
    //gl_FragCoord.xy * inverseVP)

    //118514
    vec2 v_rgbNW = (gl_FragCoord.xy + vec2(-1., 1.)) * inverseP;
    vec2 v_rgbNE = (gl_FragCoord.xy + vec2(1., 1.)) * inverseP;
    vec2 v_rgbSW = (gl_FragCoord.xy + vec2(-1., -1.)) * inverseP;
    vec2 v_rgbSE = (gl_FragCoord.xy + vec2(1., -1.)) * inverseP;
    vec2 v_rgbM = (gl_FragCoord.xy) * inverseP;

    vec4 color;
    mediump vec2 inverseVP = vec2(1.0 / u_screensize.x, 1.0 / u_screensize.y);
    vec3 rgbNW = texture(u_color, v_rgbNW).xyz;
    vec3 rgbNE = texture(u_color, v_rgbNE).xyz;
    vec3 rgbSW = texture(u_color, v_rgbSW).xyz;
    vec3 rgbSE = texture(u_color, v_rgbSE).xyz;
    vec4 texColor = texture(u_color, v_rgbM);
    vec3 rgbM  = texColor.xyz;
    vec3 luma = vec3(0.299, 0.587, 0.114);
    float lumaNW = dot(rgbNW, luma);
    float lumaNE = dot(rgbNE, luma);
    float lumaSW = dot(rgbSW, luma);
    float lumaSE = dot(rgbSE, luma);
    float lumaM  = dot(rgbM,  luma);
    float lumaMin = min(lumaM, min(min(lumaNW, lumaNE), min(lumaSW, lumaSE)));
    float lumaMax = max(lumaM, max(max(lumaNW, lumaNE), max(lumaSW, lumaSE)));
    
    mediump vec2 dir;
    dir.x = -((lumaNW + lumaNE) - (lumaSW + lumaSE));
    dir.y =  ((lumaNW + lumaSW) - (lumaNE + lumaSE));
    
    float dirReduce = max((lumaNW + lumaNE + lumaSW + lumaSE) *
                          (0.25 * FXAA_REDUCE_MUL), FXAA_REDUCE_MIN);
    
    float rcpDirMin = 1.0 / (min(abs(dir.x), abs(dir.y)) + dirReduce);
    dir = min(vec2(FXAA_SPAN_MAX, FXAA_SPAN_MAX),
              max(vec2(-FXAA_SPAN_MAX, -FXAA_SPAN_MAX),
              dir * rcpDirMin)) * inverseVP;
    
    vec3 rgbA = 0.5 * (
        texture(u_color, gl_FragCoord.xy * inverseVP + dir * (1.0 / 3.0 - 0.5)).xyz +
        texture(u_color, gl_FragCoord.xy * inverseVP + dir * (2.0 / 3.0 - 0.5)).xyz);
    vec3 rgbB = rgbA * 0.5 + 0.25 * (
        texture(u_color, gl_FragCoord.xy * inverseVP + dir * -0.5).xyz +
        texture(u_color, gl_FragCoord.xy * inverseVP + dir * 0.5).xyz);

    float lumaB = dot(rgbB, luma);
    if ((lumaB < lumaMin) || (lumaB > lumaMax))
        color = vec4(rgbA, 1.);
    else
        color = vec4(rgbB, 1.);
    
    outColor = color ;//* (hash22(gl_FragCoord.xy).x * .1 + .9);
}