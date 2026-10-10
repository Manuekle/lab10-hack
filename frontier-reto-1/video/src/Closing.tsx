import React from 'react';
import {useVideoConfig} from 'remotion';
import {BasicCaptions} from './basic-captions';
import {Frame, palette, captionStyle, display} from './Frame';
export const Closing = () => {
  const {fps} = useVideoConfig();
  return <Frame chapter="Manuel · Reto 1" dark>
    <div style={{position: 'absolute', left: 96, top: 171, ...display, fontSize: 147, color: palette.yellow}}>Del pedido<br/>al resultado.</div>
    <div style={{position: 'absolute', left: 106, top: 538, fontSize: 26, color: palette.yellow}}>Código y evidencia</div>
    <div style={{position: 'absolute', left: 102, top: 587, fontSize: 53}}>github.com/Manuekle/lab10-hack</div>
    <div style={{position: 'absolute', left: 106, top: 699, fontSize: 26, color: palette.yellow}}>Servicio desplegado</div>
    <div style={{position: 'absolute', left: 102, top: 748, fontSize: 51}}>agent-production-2577.up.railway.app</div>
    <BasicCaptions name="Subtítulos de cierre" premountFor={fps} width={1728} style={captionStyle} captions={[
      {"text":"Código público, evidencia de las pruebas y servicio desplegado en Railway.","startMs":0,"endMs":4500,"timestampMs":null,"confidence":null,"pageBreakAfter":true},
      {"text":"El agente verifica lo que hizo antes de dar la tarea por terminada.","startMs":4500,"endMs":8000,"timestampMs":null,"confidence":null,"pageBreakAfter":true}
    ]} />
  </Frame>;
};
