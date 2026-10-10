import React from 'react';
import {CanvasImage, Easing, interpolate, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import {BasicCaptions} from './basic-captions';
import {Frame, palette, captionStyle, display} from './Frame';
export const Intro = () => {
  const {fps} = useVideoConfig();
  const frame = useCurrentFrame();
  const enter = interpolate(frame, [.5 * fps, 1.2 * fps], [70, 0], {easing: Easing.out(Easing.cubic), extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  return <Frame chapter="Reto 1 · agente visual">
    <div style={{position: 'absolute', left: 96, top: 173, width: 1690, ...display, fontSize: 142}}>Cambiar una dirección.<br/><span style={{color: palette.cobalt}}>Y nada más.</span></div>
    <div style={{position: 'absolute', left: 102, top: 526, fontSize: 32, fontWeight: 600}}>La solicitud: Distribuciones El Faro / CL-0007</div>
    <div style={{position: 'absolute', left: 96 + enter, top: 605, width: 1220, height: 132, borderRadius: 12, overflow: 'hidden', background: palette.white, boxShadow: '0 16px 0 #CBD6F9'}}>
      <CanvasImage src={staticFile('e2-resultado.png')} premountFor={fps} style={{position: 'absolute', width: 3584, height: 2240, left: -1328, top: -608}} />
    </div>
    <div style={{position: 'absolute', left: 1410, top: 614, fontSize: 38, lineHeight: 1.35, color: palette.cobalt}}>La app tiene<br/>una pantalla.<br/><span style={{fontWeight: 600}}>Eso basta.</span></div>
    <BasicCaptions name="Subtítulos de apertura" premountFor={fps} width={1728} style={captionStyle} captions={[
      {"text":"Corregir una dirección en una app empresarial. Y nada más.","startMs":0,"endMs":5000,"timestampMs":null,"confidence":null,"pageBreakAfter":true},
      {"text":"Nuestro agente trabaja desde la pantalla, con mouse y teclado.","startMs":5000,"endMs":10000,"timestampMs":null,"confidence":null,"pageBreakAfter":true}
    ]} />
  </Frame>;
};
