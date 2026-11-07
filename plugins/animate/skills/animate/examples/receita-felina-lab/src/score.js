  // a quiet kitchen: a soft pad, whisk ticks in the close-up, a chime when Babidi wakes
  const T = TIMELINE, cu = T.cues;
  to = 'm';
  pad(0.0, 10.05, ['D3', 'A3', 'Fs4'], 0.03, { type: 'triangle', cut: 900, att: 0.4, rel: 0.4 });
  to = 's';
  for (let i = 0; i < 8; i++) noiseHit(cu.grab + 0.4 + i * E8 / 2, 0.04, 'highpass', 5200, 2, 0.05, 0.1);
  chime(cu.wake, [nz('A5'), nz('D6')], 0.06);
