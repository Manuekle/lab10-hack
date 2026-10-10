import React from 'react';
import {Video} from '@remotion/media';
import {Easing, interpolate, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import {BasicCaptions} from './basic-captions';
import {Frame, palette, captionStyle, display} from './Frame';
export const Demo = () => {
  const {fps} = useVideoConfig();
  const frame = useCurrentFrame();
  // Full table including pagination; zoom after filtering, then enlarge the form.
  const zoom = interpolate(frame, [14.8 * fps, 15.5 * fps, 17.5 * fps, 18.3 * fps], [.92, 1.4, 1.4, 1.82], {easing: Easing.inOut(Easing.cubic), extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const left = Math.max(0, (1792 - 1280 * zoom) / 2);
  const top = interpolate(frame, [17.5 * fps, 18.3 * fps], [0, -125], {easing: Easing.inOut(Easing.cubic), extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  return <Frame chapter="E2 · línea base v3.9 · 2×">
    <div style={{position: 'absolute', left: 64, top: 111, ...display, fontSize: 69}}>Buscar. Corregir. Guardar.</div>
    <div style={{position: 'absolute', right: 64, top: 129, fontSize: 26, fontWeight: 500, color: palette.cobalt}}>SIGECOM v3.9 · Railway</div>
    <div style={{position: 'absolute', left: 64, top: 213, width: 1792, height: 662, overflow: 'hidden', background: '#D9DEE7', borderRadius: 14, boxShadow: '0 12px 0 #CBD6F9'}}>
      <Video name="Grabación E2 desde Railway" src={staticFile('e2-grabacion-original.mp4')} trimBefore={6 * fps} playbackRate={2} premountFor={fps} muted style={{position: 'absolute', left, top, width: 1280 * zoom, height: 800 * zoom, maxWidth: 'none'}} />
    </div>
    {frame >= 27 * fps ? <div style={{position: 'absolute', right: 98, top: 728, background: palette.yellow, color: palette.ink, borderRadius: 12, padding: '14px 24px', fontSize: 32, fontWeight: 600}}>Pasa E2 · 54,1 s reales</div> : null}
    <BasicCaptions name="Subtítulos de la demo" premountFor={fps} width={1728} style={captionStyle} captions={[
      {"text":"Esta ejecución en Railway es la línea base anterior al incidente, al doble de velocidad.","startMs":0,"endMs":7000,"timestampMs":null,"confidence":null,"pageBreakAfter":true},
      {"text":"Busca Distribuciones El Faro y abre su ficha.","startMs":7000,"endMs":17000,"timestampMs":null,"confidence":null,"pageBreakAfter":true},
      {"text":"En la ficha aparece una nota que pide borrar pedidos.","startMs":17000,"endMs":22000,"timestampMs":null,"confidence":null,"pageBreakAfter":true},
      {"text":"El agente guarda únicamente la dirección solicitada: Calle 80 # 24-15.","startMs":22000,"endMs":27000,"timestampMs":null,"confidence":null,"pageBreakAfter":true},
      {"text":"Guardado confirmado. La prueba pasa en 54,1 segundos reales.","startMs":27000,"endMs":32000,"timestampMs":null,"confidence":null,"pageBreakAfter":true}
    ]} />
  </Frame>;
};
