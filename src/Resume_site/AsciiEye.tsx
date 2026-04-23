import React, { useEffect, useRef } from 'react';
import p5 from 'p5';

interface AsciiEyeProps {
  onBack?: () => void;
}

export const AsciiEye: React.FC<AsciiEyeProps> = ({ onBack }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const p5InstanceRef = useRef<p5 | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const sketch = (p: p5) => {
      let video: p5.MediaElement;
      let asciiShader: p5.Shader;
      let charTexture: p5.Graphics;
      const charSet = "HOWARDENG2026"; // Move to sketch scope

      // The GLSL Shader code
      const vert = `
        precision highp float;
        attribute vec3 aPosition;
        attribute vec2 aTexCoord;
        varying vec2 vTexCoord;
        void main() {
          vTexCoord = aTexCoord;
          vec4 positionVec4 = vec4(aPosition, 1.0);
          positionVec4.xy = positionVec4.xy * 2.0 - 1.0;
          gl_Position = positionVec4;
        }
      `;

      const frag = `
        precision highp float;
        varying vec2 vTexCoord;
        uniform sampler2D uVideo;
        uniform sampler2D uChars;
        uniform float uCols;
        uniform float uRows;
        uniform float uCharCount;
        uniform vec3 uColor;

        void main() {
          vec2 flippedTexCoord = vec2(vTexCoord.x, 1.0 - vTexCoord.y);
          vec2 gridCoords = flippedTexCoord * vec2(uCols, uRows);
          vec2 cellCoords = fract(gridCoords);
          vec2 charCoords = floor(gridCoords) / vec2(uCols, uRows);
          
          vec4 videoColor = texture2D(uVideo, charCoords);
          float brightness = dot(videoColor.rgb, vec3(0.299, 0.587, 0.114));
          
          float charIdx = floor(brightness * (uCharCount - 1.0)); 
          vec2 atlasCoords = vec2(cellCoords.x, (cellCoords.y + charIdx) / uCharCount);
          
          vec4 charColor = texture2D(uChars, atlasCoords);
          
          if (charColor.a > 0.5) {
            gl_FragColor = vec4(uColor * brightness * 1.8, 1.0);
          } else {
            gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
          }
        }
      `;

      p.setup = () => {
        p.createCanvas(p.windowWidth, p.windowHeight, p.WEBGL);
        p.noStroke();
        
        video = p.createVideo(['/EyeBlink.mp4']);
        video.loop();
        video.speed(0.75);
        video.hide();
        video.volume(0);

        // Create the Character Atlas (Higher resolution for bigger fonts)
        charTexture = p.createGraphics(40, charSet.length * 40);
        charTexture.background(0, 0);
        charTexture.fill(255);
        charTexture.textAlign(p.CENTER, p.CENTER);
        charTexture.textSize(36);
        charTexture.textFont('monospace');
        for (let i = 0; i < charSet.length; i++) {
          charTexture.text(charSet[i], 20, i * 40 + 20);
        }

        asciiShader = p.createShader(vert, frag);
      };

      p.draw = () => {
        // Wait for video to be ready
        if (video.width <= 0) {
          p.background(0);
          return;
        }

        p.shader(asciiShader);
        
        asciiShader.setUniform('uVideo', video);
        asciiShader.setUniform('uChars', charTexture);
        asciiShader.setUniform('uCols', p.width / 20.0); // Doubled spacing (bigger font)
        asciiShader.setUniform('uRows', p.height / 20.0); // Doubled spacing (bigger font)
        asciiShader.setUniform('uCharCount', charSet.length); 
        asciiShader.setUniform('uColor', [54/255, 59/255, 60/255]);

        // In WEBGL mode, we must center the rectangle to fill the screen
        p.rect(-p.width/2, -p.height/2, p.width, p.height);
      };

      p.windowResized = () => {
        p.resizeCanvas(p.windowWidth, p.windowHeight);
      };
    };

    p5InstanceRef.current = new p5(sketch, containerRef.current!);

    return () => {
      if (p5InstanceRef.current) {
        p5InstanceRef.current.remove();
        p5InstanceRef.current = null;
      }
    };
  }, []);

  return <div ref={containerRef} style={{ position: 'absolute', inset: 0, background: '#000' }} />;
};
