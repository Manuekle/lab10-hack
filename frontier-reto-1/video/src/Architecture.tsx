import React from 'react';
import {interpolate, useCurrentFrame, useVideoConfig} from 'remotion';
import {BasicCaptions} from './basic-captions';
import {Frame, palette, captionStyle, display} from './Frame';
export const Architecture = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const pathLength = interpolate(frame, [.6 * fps, 2 * fps], [1600, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  return <Frame chapter="Una decisión por captura">
    <div style={{position: 'absolute', left: 96, top: 158, ...display, fontSize: 110}}>Mirar. Actuar. Comprobar.</div>
    <svg width={1920} height={1080} style={{position: 'absolute', inset: 0}}>
      <defs><marker id="arrow" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto"><path d="M0 0 L9 4.5 L0 9" fill={palette.cobalt}/></marker></defs>
      <g fill="none" stroke={palette.cobalt} strokeWidth={4} strokeDasharray={1600} strokeDashoffset={pathLength}>
        <path d="M450 404 H537" markerEnd="url(#arrow)"/>
        <path d="M969 381 H1162" markerEnd="url(#arrow)"/>
        <path d="M1169 452 H976" markerEnd="url(#arrow)"/>
        <path d="M760 533 V625" markerEnd="url(#arrow)"/>
        <path d="M958 720 H1162" markerEnd="url(#arrow)"/>
      </g>
    </svg>
    <div style={{position: 'absolute', left: 96, top: 356, width: 350}}><div style={{fontSize: 49, fontWeight: 600}}>API de tareas</div><div style={{fontSize: 29, lineHeight: 1.4, marginTop: 23, color: palette.muted}}>Entrada autenticada.<br/>Respuesta inmediata.</div></div>
    <div style={{position: 'absolute', left: 555, top: 339, width: 414, height: 198, borderRadius: 16, padding: '26px 24px', boxSizing: 'border-box', background: palette.yellow}}><div style={{...display, fontSize: 62}}>Supervisor</div><div style={{fontSize: 30, marginTop: 20}}>Intención, límites y evidencia.</div></div>
    <div style={{position: 'absolute', left: 1190, top: 354, width: 625}}><div style={{fontSize: 49, fontWeight: 600}}>Worker visual</div><div style={{fontSize: 30, lineHeight: 1.4, marginTop: 23, color: palette.muted}}>Lee la captura.<br/>Propone la siguiente acción.</div></div>
    <div style={{position: 'absolute', left: 582, top: 655, width: 415}}><div style={{fontSize: 49, fontWeight: 600}}>Driver RFB</div><div style={{fontSize: 30, marginTop: 21, color: palette.muted}}>Mouse, teclado y capturas.</div></div>
    <div style={{position: 'absolute', left: 1190, top: 655, width: 625}}><div style={{fontSize: 49, fontWeight: 600}}>Escritorio VNC</div><div style={{fontSize: 30, marginTop: 21, color: palette.muted}}>La aplicación real.</div></div>
    <div style={{position: 'absolute', left: 96, top: 658, width: 350, fontSize: 34, color: palette.cobalt, lineHeight: 1.25}}>Una propuesta<br/>pasa por el<br/>supervisor.</div>
    <BasicCaptions name="Subtítulos de arquitectura" premountFor={fps} width={1728} style={captionStyle} captions={[
      {"text":"La API recibe la tarea. El supervisor coordina y fija sus límites.","startMs":0,"endMs":4500,"timestampMs":null,"confidence":null,"pageBreakAfter":true},
      {"text":"El worker interpreta la captura y propone. El driver actúa por VNC.","startMs":4500,"endMs":9500,"timestampMs":null,"confidence":null,"pageBreakAfter":true},
      {"text":"Cada cambio se comprueba en pantalla antes de dar la tarea por terminada.","startMs":9500,"endMs":14000,"timestampMs":null,"confidence":null,"pageBreakAfter":true}
    ]} />
  </Frame>;
};
