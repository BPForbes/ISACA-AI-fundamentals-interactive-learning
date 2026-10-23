// Pixel-art icons from pixelarticons (MIT, Gerrit Halfmann; see THIRD_PARTY_LICENSES.md).
// Each SVG is drawn in currentColor, so it is applied as a CSS mask over the text
// colour and follows the theme. Only the icons the game uses are imported.
import type { CSSProperties } from 'react';
import archive from 'pixelarticons/svg/archive.svg';
import batteryMedium from 'pixelarticons/svg/battery-medium.svg';
import castle from 'pixelarticons/svg/castle.svg';
import chartLine from 'pixelarticons/svg/chart-line.svg';
import check from 'pixelarticons/svg/check.svg';
import coins from 'pixelarticons/svg/coins.svg';
import cpu from 'pixelarticons/svg/cpu.svg';
import eye from 'pixelarticons/svg/eye.svg';
import flag from 'pixelarticons/svg/flag.svg';
import gamepad from 'pixelarticons/svg/gamepad.svg';
import heart from 'pixelarticons/svg/heart.svg';
import human from 'pixelarticons/svg/human.svg';
import lightbulb from 'pixelarticons/svg/lightbulb.svg';
import notebook from 'pixelarticons/svg/notebook.svg';
import repeat from 'pixelarticons/svg/repeat.svg';
import scale from 'pixelarticons/svg/scale.svg';
import server from 'pixelarticons/svg/server.svg';
import shield from 'pixelarticons/svg/shield.svg';
import sliders from 'pixelarticons/svg/sliders.svg';
import target from 'pixelarticons/svg/target.svg';
import trendingUp from 'pixelarticons/svg/trending-up.svg';
import trophy from 'pixelarticons/svg/trophy.svg';
import warningDiamond from 'pixelarticons/svg/warning-diamond.svg';
import zap from 'pixelarticons/svg/zap.svg';

export const ICONS = {
  archive,
  'battery-medium': batteryMedium,
  castle,
  'chart-line': chartLine,
  check,
  coins,
  cpu,
  eye,
  flag,
  gamepad,
  heart,
  human,
  lightbulb,
  notebook,
  repeat,
  scale,
  server,
  shield,
  sliders,
  target,
  'trending-up': trendingUp,
  trophy,
  'warning-diamond': warningDiamond,
  zap,
} as const;

export type IconName = keyof typeof ICONS;

export const isIconName = (name: string): name is IconName => name in ICONS;

/** Decorative unless a label is given, in which case it reads as an image. */
export function PixelIcon({ name, label, className }: { name: string; label?: string; className?: string }) {
  if (!isIconName(name)) return null;
  return (
    <span
      className={className ? `px-icon ${className}` : 'px-icon'}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      style={{ '--icon': `url("${ICONS[name]}")` } as CSSProperties}
    />
  );
}
