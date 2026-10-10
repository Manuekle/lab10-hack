import React from 'react';
import {AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig} from 'remotion';
import './fonts';
export const palette = {ink: '#172351', mist: '#E7EDFF', cobalt: '#2542CA', white: '#F9FAFF', yellow: '#FFE678', muted: '#61709A', line: '#C7D2F2'};
export const display: React.CSSProperties = {fontFamily: 'Cooper', fontWeight: 400, lineHeight: 1.02, letterSpacing: -2};
export const Frame: React.FC<{chapter: string; children: React.ReactNode; dark?: boolean}> = ({chapter, children, dark = false}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const reveal = interpolate(frame, [0, .45 * fps], [0, 1], {easing: Easing.out(Easing.cubic), extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  return <AbsoluteFill style={{backgroundColor: dark ? palette.cobalt : palette.mist, color: dark ? palette.white : palette.ink, fontFamily: 'SF Text', fontWeight: 400}}>
    <div style={{position: 'absolute', left: 64, top: 42, right: 64, display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 25, fontWeight: 600}}>
      <span style={{display: 'flex', alignItems: 'center', gap: 14}}><svg width="27" height="31" viewBox="0 0 27 31"><path d="M2 2 L24 19 L14 20 L9 29 Z" fill={dark ? palette.yellow : palette.cobalt}/></svg>Manuel / Frontier</span>
      <span style={{color: dark ? palette.yellow : palette.cobalt, fontWeight: 500}}>{chapter}</span>
    </div>
    <div style={{position: 'absolute', inset: 0, opacity: reveal, transform: `translateY(${(1 - reveal) * 16}px)`}}>{children}</div>
  </AbsoluteFill>;
};
export const captionStyle: React.CSSProperties = {position: 'absolute', bottom: 38, left: 96, height: 132};
