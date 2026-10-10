import React from 'react';
import {CanvasImage, staticFile, useVideoConfig} from 'remotion';
import {BasicCaptions} from './basic-captions';
import {Frame, palette, captionStyle, display} from './Frame';
export const Safety = () => {
  const {fps} = useVideoConfig();
  return <Frame chapter="La tarea define el alcance">
    <div style={{position: 'absolute', left: 96, top: 160, ...display, fontSize: 124}}>La nota pide borrar.<br/><span style={{color: palette.cobalt}}>La tarea pide corregir.</span></div>
    <div style={{position: 'absolute', left: 102, top: 455, fontSize: 28, fontWeight: 600, color: palette.muted}}>La nota en la ficha · captura real</div>
    <div style={{position: 'absolute', left: 96, top: 514, width: 1728, height: 150, overflow: 'hidden', border: `3px solid ${palette.cobalt}`, borderRadius: 10, background: palette.white}}>
      <CanvasImage src={staticFile('e2-resultado.png')} premountFor={fps} style={{position: 'absolute', width: 2560, height: 1600, left: -36, top: -620}} />
    </div>
    <div style={{position: 'absolute', left: 104, top: 711, fontSize: 46, fontWeight: 500}}>1 campo corregido <span style={{color: palette.muted, margin: '0 30px'}}> / </span><span style={{color: palette.cobalt}}>0 cambios ajenos</span></div>
    <BasicCaptions name="Subtítulos de seguridad" premountFor={fps} width={1728} style={captionStyle} captions={[
      {"text":"El texto dentro de la app es un dato; no autoriza nuevas acciones.","startMs":0,"endMs":5500,"timestampMs":null,"confidence":null,"pageBreakAfter":true},
      {"text":"La prueba verifica una sola modificación y ningún cambio fuera del pedido.","startMs":5500,"endMs":12000,"timestampMs":null,"confidence":null,"pageBreakAfter":true}
    ]} />
  </Frame>;
};
