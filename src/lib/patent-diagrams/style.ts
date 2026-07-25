export interface PatentDiagramStyle {
  direction: 'top-to-bottom'
  background: '#FFFFFF'
  foreground: '#000000'
  shadowing: false
  cornerRadius: 0
  componentStyle: 'rectangle'
  fontFamily: 'SansSerif'
  baseFontSize: 13
  titleFontSize: 16
  arrowThickness: 1.1
  componentBorderThickness: 1.0
  subsystemBorderThickness: 1.3
  systemBorderThickness: 1.8
  // Measured against a live render, not estimated. The two knobs are not
  // interchangeable:
  //   nodesep only widens COMPONENT figures (a worst-case 4-wide/4-band figure
  //     goes 926 -> 944 px for 34 -> 40, costing page-fit) and does nothing for
  //     PROCESS, whose width is pinned by the widest step box.
  //   ranksep is free for COMPONENT (band heights are label-driven: 687 px at
  //     38, 62 and 80 alike) and is the only lever on PROCESS, where it is the
  //     gap between steps: 810 -> 978 px at 38 -> 62, still at the 9.75 pt
  //     page-fit ceiling. 80 would reach 1104 px and drop to 8.75 pt, too close
  //     to the 8 pt filing floor.
  // So vertical spacing is bought and horizontal is left alone.
  horizontalNodeSpacing: 34
  verticalRankSpacing: 62
  maximumComponentsPerRow: 4
  maximumLabelWords: 7
  maximumLabelLines: 3
}

export const PATENT_DIAGRAM_STYLE: Readonly<PatentDiagramStyle> = Object.freeze({
  direction: 'top-to-bottom',
  background: '#FFFFFF',
  foreground: '#000000',
  shadowing: false,
  cornerRadius: 0,
  componentStyle: 'rectangle',
  fontFamily: 'SansSerif',
  baseFontSize: 13,
  titleFontSize: 16,
  arrowThickness: 1.1,
  componentBorderThickness: 1.0,
  subsystemBorderThickness: 1.3,
  systemBorderThickness: 1.8,
  horizontalNodeSpacing: 34,
  verticalRankSpacing: 62,
  maximumComponentsPerRow: 4,
  maximumLabelWords: 7,
  maximumLabelLines: 3,
})

export function compilePatentDiagramStyle(style: PatentDiagramStyle = PATENT_DIAGRAM_STYLE): string {
  return `skinparam backgroundColor ${style.background}
skinparam monochrome true
skinparam shadowing ${style.shadowing}
skinparam roundcorner ${style.cornerRadius}
skinparam defaultFontName ${style.fontFamily}
skinparam defaultFontSize ${style.baseFontSize}
skinparam defaultTextAlignment center
skinparam ArrowColor ${style.foreground}
skinparam ArrowThickness ${style.arrowThickness}
skinparam linetype ortho
skinparam nodesep ${style.horizontalNodeSpacing}
skinparam ranksep ${style.verticalRankSpacing}
skinparam rectangle {
  BackgroundColor ${style.background}
  BorderColor ${style.foreground}
  BorderThickness ${style.componentBorderThickness}
  FontColor ${style.foreground}
  FontName ${style.fontFamily}
  FontSize ${style.baseFontSize}
  RoundCorner ${style.cornerRadius}
}
skinparam rectangle<<SUBSYSTEM>> {
  BackgroundColor ${style.background}
  BorderColor ${style.foreground}
  BorderThickness ${style.subsystemBorderThickness}
  FontColor ${style.foreground}
  FontStyle bold
}
skinparam rectangle<<SYSTEM>> {
  BackgroundColor ${style.background}
  BorderColor ${style.foreground}
  BorderThickness ${style.systemBorderThickness}
  FontColor ${style.foreground}
  FontSize ${style.titleFontSize}
  FontStyle bold
}
skinparam rectangle<<DECISION>> {
  BackgroundColor ${style.background}
  BorderColor ${style.foreground}
  BorderThickness ${style.subsystemBorderThickness}
  FontColor ${style.foreground}
}
skinparam activity {
  BackgroundColor ${style.background}
  BorderColor ${style.foreground}
  FontColor ${style.foreground}
}
skinparam actor {
  BackgroundColor ${style.background}
  BorderColor ${style.foreground}
  FontColor ${style.foreground}
}
skinparam participant {
  BackgroundColor ${style.background}
  BorderColor ${style.foreground}
  FontColor ${style.foreground}
  BorderThickness ${style.componentBorderThickness}
}
skinparam sequence {
  LifeLineBorderColor ${style.foreground}
  LifeLineBackgroundColor ${style.background}
  ArrowColor ${style.foreground}
  ParticipantBackgroundColor ${style.background}
  ParticipantBorderColor ${style.foreground}
  GroupBackgroundColor ${style.background}
  GroupBorderColor ${style.foreground}
  GroupFontColor ${style.foreground}
  GroupHeaderFontColor ${style.foreground}
}
hide stereotype`
}

export function wrapPatentLabel(
  value: string,
  options: { maximumWords?: number; maximumLines?: number; targetCharactersPerLine?: number } = {},
): string[] {
  const maximumWords = options.maximumWords ?? PATENT_DIAGRAM_STYLE.maximumLabelWords
  const maximumLines = options.maximumLines ?? PATENT_DIAGRAM_STYLE.maximumLabelLines
  const targetCharacters = options.targetCharactersPerLine ?? 20
  const words = String(value || '').trim().split(/\s+/).filter(Boolean).slice(0, maximumWords)
  if (!words.length) return ['Unnamed element']

  const lines: string[] = []
  for (const word of words) {
    const current = lines[lines.length - 1]
    if (!current) {
      lines.push(word)
      continue
    }
    if (lines.length < maximumLines && `${current} ${word}`.length > targetCharacters) {
      lines.push(word)
    } else {
      lines[lines.length - 1] = `${current} ${word}`
    }
  }

  while (lines.length > maximumLines) {
    const tail = lines.pop()
    lines[lines.length - 1] = `${lines[lines.length - 1]} ${tail}`
  }
  return lines
}

export function escapePlantUmlLabel(value: string): string {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/[\r\n]+/g, ' ')
    .trim()
}
