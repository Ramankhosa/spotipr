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
  horizontalNodeSpacing: 34
  verticalRankSpacing: 38
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
  verticalRankSpacing: 38,
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
