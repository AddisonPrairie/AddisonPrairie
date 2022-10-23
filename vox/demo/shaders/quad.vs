#version 300 es

//basic vertex shader for full screen quad
in vec4 a_position;

void main() {
    gl_Position = a_position;
}