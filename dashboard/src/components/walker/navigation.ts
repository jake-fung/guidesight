/**
 * Turn-by-turn walking guidance from a Google Maps route (server /api/routes).
 *
 * Every GPS fix goes to Navigator.update(), which works out where the walker is on the route and
 * returns at most one thing to say: the next turn coming up ("In 50 metres, turn left onto King
 * Street"), the turn itself, distance milestones ("500 metres to go"), drifting off the path, being
 * off the route (the session then asks for a new one), or arriving.
 *
 * Directions are spoken from the compass as "walk left", "walk right", "walk straight ahead" or "walk to
 * 4 o'clock", relative to the way the walker faces (12 = straight ahead, 3 = right), since "head north"
 * means little without sight. No React or browser APIs here.
 */
import type { LatLng, Route } from '../../lib/api'

const EARTH_M = 6_371_000
const rad = (d: number) => (d * Math.PI) / 180
const deg = (r: number) => (r * 180) / Math.PI

/** Turn announcement this close to the corner. */
const TURN_M = 12
/** "In 50 metres, …" this far before a turn (only on steps long enough to need a warning). */
const PREPARE_M = 50
const ARRIVE_M = 10
/** Off the route by more than this (plus GPS error) for OFF_FIXES fixes in a row = re-route. */
const OFF_ROUTE_M = 30
const OFF_FIXES = 3
const OFF_ROUTE_COOLDOWN_MS = 30_000
/** Walking more than this many degrees away from the path for VEER_FIXES fixes = "bear left/right". */
const VEER_DEG = 50
const VEER_FIXES = 3
const VEER_COOLDOWN_MS = 20_000
/** "N metres to go" each time the remaining distance passes a multiple of this. */
const MILESTONE_M = 250

export function metres(a: LatLng, b: LatLng) {
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_M * Math.asin(Math.sqrt(h))
}

/** Compass bearing from a to b, 0–360 (0 = north, 90 = east). */
export function bearing(a: LatLng, b: LatLng) {
  const y = Math.sin(rad(b.lng - a.lng)) * Math.cos(rad(b.lat))
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lng - a.lng))
  return (deg(Math.atan2(y, x)) + 360) % 360
}

/** Angle from `facing` to `target`, -180…180 (negative = to the left). */
export const relative = (target: number, facing: number) => ((target - facing + 540) % 360) - 180

/** -90 → 9 (o'clock), 0 → 12, 45 → 2 (rounded to the nearest hour). */
export function toClock(rel: number) {
  const h = Math.round((((rel % 360) + 360) % 360) / 30) % 12
  return h === 0 ? 12 : h
}

/** Compass direction as an instruction: "walk left", "walk right", "walk straight ahead", "walk to 4 o’clock". */
export function walkPhrase(rel: number) {
  const clock = toClock(rel)
  if (clock === 12) return 'walk straight ahead'
  if (clock === 3) return 'walk right'
  if (clock === 9) return 'walk left'
  if (clock === 6) return 'turn around and walk to 6 o’clock'
  return `walk to ${clock} o’clock`
}

/** Spoken distance, rounded the way people say it: "5 metres", "40 metres", "350 metres", "1.2 kilometres". */
export function distance(m: number) {
  if (m >= 950) {
    const km = Math.round(m / 100) / 10
    return `${km} kilometre${km === 1 ? '' : 's'}`
  }
  const step = m < 20 ? 5 : m < 100 ? 10 : 50
  return `${Math.max(5, Math.round(m / step) * step)} metres`
}

/** Short form for the screen: "40 m", "1.2 km". */
export function shortDistance(m: number) {
  return m >= 950 ? `${(Math.round(m / 100) / 10).toFixed(1)} km` : `${Math.max(0, Math.round(m / 5) * 5)} m`
}

export function minutes(s: number) {
  const n = Math.max(1, Math.round(s / 60))
  return `${n} minute${n === 1 ? '' : 's'}`
}

const STREET_WORDS: Record<string, string> = {
  St: 'Street', Ave: 'Avenue', Rd: 'Road', Blvd: 'Boulevard', Dr: 'Drive', Ln: 'Lane', Pl: 'Place',
  Ct: 'Court', Cres: 'Crescent', Hwy: 'Highway', Pkwy: 'Parkway', Sq: 'Square', Terr: 'Terrace',
}
const COMPASS_WORDS: Record<string, string> = {
  N: 'North', S: 'South', E: 'East', W: 'West', NE: 'Northeast', NW: 'Northwest', SE: 'Southeast', SW: 'Southwest',
}

/** Google's abbreviations read badly aloud ("King St W" → "King Street West"). */
export function speakable(text: string) {
  return text
    // "St" only at the end of a name (so "St Clair" stays as it is).
    .replace(/\b(St|Ave|Rd|Blvd|Dr|Ln|Pl|Ct|Cres|Hwy|Pkwy|Sq|Terr)\b\.?(?=\s+(?:N|S|E|W|NE|NW|SE|SW)\b|\s*[.,/]|\s+(?:toward|towards|onto|and|then|to)\b|\s*$)/g,
      (_, w: string) => STREET_WORDS[w])
    .replace(/\b(Street|Avenue|Road|Boulevard|Drive|Lane|Place|Court|Crescent|Way|Highway|Parkway) (N|S|E|W|NE|NW|SE|SW)\b/g,
      (_, w: string, d: string) => `${w} ${COMPASS_WORDS[d]}`)
}

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1)
const capitalFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
/** "Turn right onto Demo Avenue. Destination will be on the left" → "Turn right onto Demo Avenue" */
const mainPart = (instruction: string) => instruction.split(/\.\s+|\n/)[0].trim()

/** "Tim Hortons, 123 Queen Street West. It's 650 metres away, about 8 minutes on foot." */
export function routeSummary(route: Route) {
  const { name, address } = route.destination
  const street = address.split(',')[0].trim()
  const where = street && !name.includes(street) && !street.startsWith('[mock]') ? `, ${speakable(street)}` : ''
  return `${name}${where}. It’s ${distance(route.distance_m)} away, about ${minutes(route.duration_s)} on foot.`
}

type Leg = { points: LatLng[]; cum: number[]; length: number }

function makeLeg(points: [number, number][]): Leg {
  const pts = points.map(([lat, lng]) => ({ lat, lng }))
  const cum = [0]
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + metres(pts[i - 1], pts[i]))
  return { points: pts, cum, length: cum[cum.length - 1] }
}

/** Nearest point on a step's path: how far `here` is from it, how far along the step, which way it runs. */
function nearest(leg: Leg, here: LatLng) {
  const kx = EARTH_M * Math.cos(rad(here.lat))
  // Flat x/y in metres with `here` at (0, 0): fine over a few kilometres.
  const xy = (p: LatLng) => [rad(p.lng - here.lng) * kx, rad(p.lat - here.lat) * EARTH_M]
  let best = { off: Infinity, along: 0, heading: 0 }
  if (leg.points.length === 1) return { off: metres(here, leg.points[0]), along: 0, heading: 0 }
  for (let i = 1; i < leg.points.length; i++) {
    const [ax, ay] = xy(leg.points[i - 1])
    const [bx, by] = xy(leg.points[i])
    const dx = bx - ax
    const dy = by - ay
    const len2 = dx * dx + dy * dy
    const t = len2 ? Math.min(1, Math.max(0, -(ax * dx + ay * dy) / len2)) : 0
    const off = Math.hypot(ax + t * dx, ay + t * dy)
    if (off < best.off) {
      best = { off, along: leg.cum[i - 1] + t * (leg.cum[i] - leg.cum[i - 1]), heading: bearing(leg.points[i - 1], leg.points[i]) }
    }
  }
  return best
}

/** The point `d` metres along a step. */
function pointAlong(leg: Leg, d: number): LatLng {
  const pts = leg.points
  for (let i = 1; i < pts.length; i++) {
    if (leg.cum[i] >= d) {
      const span = leg.cum[i] - leg.cum[i - 1]
      const t = span ? (d - leg.cum[i - 1]) / span : 0
      return { lat: pts[i - 1].lat + t * (pts[i].lat - pts[i - 1].lat), lng: pts[i - 1].lng + t * (pts[i].lng - pts[i - 1].lng) }
    }
  }
  return pts[pts.length - 1]
}

/** 1 = useful, 2 = say it even over other news (turns, arriving, re-routing). */
export type NavEvent = { kind: 'turn' | 'prepare' | 'progress' | 'veer' | 'arrive' | 'offroute'; text: string; priority: 1 | 2 }

export type NavStatus = {
  step: number
  /** What to do next, for the screen ("Turn left onto King Street"). */
  next: string
  /** Metres to the next turn (or to the destination on the last step). */
  toTurn: number
  /** Metres left on the whole route. */
  remaining: number
  /** Metres from the route at the last fix. */
  offBy: number
  arrived: boolean
}

export type Fix = {
  here: LatLng
  /** GPS accuracy in metres. */
  accuracy?: number
  /** Direction of travel from GPS (degrees), when walking. null = standing still. */
  course?: number | null
  /** Compass heading the walker faces (falls back to `course`). */
  facing?: number | null
  at?: number
}

export class Navigator {
  readonly route: Route
  status: NavStatus
  private legs: Leg[]
  private said = new Set<string>()
  private milestone: number
  private offFixes = 0
  private lastOffRoute = -Infinity
  private veerFixes = 0
  private lastVeer = -Infinity
  private along = 0

  constructor(route: Route) {
    this.route = route
    this.legs = route.steps.map((s) => makeLeg(s.points))
    const total = this.legs.reduce((sum, l) => sum + l.length, 0)
    this.milestone = Math.floor(total / MILESTONE_M)
    this.status = {
      step: 0, next: this.nextText(0), toTurn: this.legs[0]?.length ?? 0, remaining: total, offBy: 0,
      arrived: route.steps.length === 0,
    }
    // The first instruction is spoken by startText(), not as a turn.
    this.said.add('turn:0')
  }

  private get name() {
    return this.route.destination.name
  }

  /** Google's text for the maneuver that ends step `i` (the start of step i + 1), or the arrival. */
  private nextText(i: number) {
    const next = this.route.steps[i + 1]
    return next ? speakable(mainPart(next.instruction)) : `Arrive at ${this.name}`
  }

  /** Direction the route runs at the end of step `i` (the road the walker comes along). */
  private arrivingHeading(i: number) {
    const leg = this.legs[i]
    return bearing(pointAlong(leg, Math.max(0, leg.length - 15)), leg.points[leg.points.length - 1])
  }

  /**
   * The turn at the end of step `i` as a compass instruction: "Walk right onto Queen Street West".
   * Relative to `facing` (the compass) when known, otherwise to the road being walked along.
   * Falls back to Google's words when the next step is too short to have a direction.
   */
  private turnText(i: number, facing: number | null) {
    const next = this.route.steps[i + 1]
    const leg = this.legs[i + 1]
    if (!next || !leg) return `Arrive at ${this.name}`
    if (leg.length < 3) return speakable(mainPart(next.instruction))
    const heading = bearing(leg.points[0], pointAlong(leg, Math.min(15, leg.length)))
    const rel = relative(heading, facing ?? this.arrivingHeading(i))
    const street = mainPart(next.instruction).match(/\b(?:onto|on) (.+?)(?: toward| towards|$)/)?.[1]
    return capitalFirst(`${walkPhrase(rel)}${street ? ` onto ${speakable(street)}` : ''}`)
  }

  /** "It's on your left." from Google's "Destination will be on the left". */
  private arrivalSide() {
    const last = this.route.steps[this.route.steps.length - 1]
    const side = last?.instruction.match(/destination will be on the (left|right)/i)?.[1]
    return side ? ` It’s on your ${side.toLowerCase()}.` : ''
  }

  /** What to say as the walk starts. `facing` is the compass heading the walker faces, if known. */
  startText(facing: number | null) {
    const first = this.route.steps[0]
    if (!first) return `You’re already at ${this.name}.`
    const leg = this.legs[0]
    const target = pointAlong(leg, Math.min(15, leg.length))
    const on = mainPart(first.instruction).match(/\bon (.+?)(?: toward| towards|$)/)?.[1]
    const along = on ? ` along ${speakable(on)}` : ''
    if (facing === null) return `${speakable(mainPart(first.instruction))}, for ${distance(leg.length)}.`
    const rel = relative(bearing(leg.points[0], target), facing)
    return `${capitalFirst(walkPhrase(rel))} for ${distance(leg.length)}${along}.`
  }

  /** Answers "repeat", "how far" and "which way" during the walk. */
  describe(ask: 'next' | 'far' | 'way', facing: number | null, here?: LatLng) {
    const s = this.status
    if (s.arrived) return `You’ve arrived at ${this.name}.`
    const isLast = !this.route.steps[s.step + 1]
    if (ask === 'far') {
      return `${distance(s.remaining)} to ${this.name}.` +
        (isLast ? '' : ` Next, in ${distance(s.toTurn)}, ${lowerFirst(this.turnText(s.step, null))}.`)
    }
    if (ask === 'way') {
      if (facing === null || !here) return 'I can’t tell which way you’re facing yet. Walk a few steps, then ask again.'
      const leg = this.legs[s.step]
      const target = pointAlong(leg, Math.min(leg.length, this.along + 15))
      return `${capitalFirst(walkPhrase(relative(bearing(here, target), facing)))}.`
    }
    // Still some way off, the turn is told relative to the road, so it doesn't swing with the compass.
    return !isLast
      ? `In ${distance(s.toTurn)}, ${lowerFirst(this.turnText(s.step, null))}.`
      : `${this.name} is ${distance(s.toTurn)} ahead.${this.arrivalSide()}`
  }

  /** Feed every GPS fix. Returns what to say now, if anything. */
  update({ here, accuracy = 10, course = null, facing = null, at = Date.now() }: Fix): NavEvent | null {
    const heading = facing ?? course
    if (this.status.arrived) return null
    const steps = this.route.steps
    const last = steps.length - 1

    // Where on the route: the current step or one of the next two (never back).
    let step = this.status.step
    let hit = nearest(this.legs[step], here)
    for (let i = step + 1; i <= Math.min(step + 2, last); i++) {
      const h = nearest(this.legs[i], here)
      if (h.off < hit.off - 2) {
        step = i
        hit = h
      }
    }

    // Off the route: re-route after a few bad fixes in a row (GPS jumps around in cities).
    if (hit.off > OFF_ROUTE_M + Math.min(accuracy, 40)) {
      this.status = { ...this.status, offBy: hit.off }
      if (++this.offFixes >= OFF_FIXES && at - this.lastOffRoute > OFF_ROUTE_COOLDOWN_MS) {
        this.offFixes = 0
        this.lastOffRoute = at
        return { kind: 'offroute', text: 'You’re off the route. Finding a new way.', priority: 2 }
      }
      return null
    }
    this.offFixes = 0

    const advanced = step > this.status.step
    this.along = hit.along
    const toTurn = Math.max(0, this.legs[step].length - hit.along)
    let remaining = toTurn
    for (let i = step + 1; i <= last; i++) remaining += this.legs[i].length
    this.status = { step, next: this.nextText(step), toTurn, remaining, offBy: hit.off, arrived: false }

    const say: string[] = []
    let priority: 1 | 2 = 1
    let kind: NavEvent['kind'] = 'progress'
    const once = (key: string) => !this.said.has(key) && !!this.said.add(key)

    // Passed a corner without hearing its turn (GPS jumped): say it now.
    if (advanced && once(`turn:${step}`)) {
      say.push(`${this.turnText(step - 1, heading)}.`)
      kind = 'turn'
      priority = 2
    }
    if (advanced && toTurn > 60) say.push(`Continue for ${distance(toTurn)}.`)

    const end = metres(here, this.route.destination.location)
    if (step === last && (toTurn <= ARRIVE_M || end <= ARRIVE_M)) {
      this.status = { ...this.status, arrived: true, toTurn: 0, remaining: 0 }
      return { kind: 'arrive', text: `You’ve arrived at ${this.name}.${this.arrivalSide()}`, priority: 2 }
    }

    if (step < last) {
      if (toTurn <= TURN_M && once(`turn:${step + 1}`)) {
        this.said.add(`prepare:${step + 1}`)
        // At the corner: from the compass, the way they actually face.
        say.push(`Now ${lowerFirst(this.turnText(step, heading))}.`)
        kind = 'turn'
        priority = 2
      } else if (toTurn <= PREPARE_M && toTurn > TURN_M + 8 && this.legs[step].length > PREPARE_M + 30 && once(`prepare:${step + 1}`)) {
        say.push(`In ${distance(toTurn)}, ${lowerFirst(this.turnText(step, null))}.`)
        kind = 'prepare'
      }
    } else if (toTurn <= PREPARE_M && this.legs[step].length > PREPARE_M + 20 && once('prepare:end')) {
      say.push(`${capitalFirst(this.name)} is ${distance(toTurn)} ahead.${this.arrivalSide()}`)
      kind = 'prepare'
    }

    // Distance milestones, only when there's nothing else to say.
    const milestone = Math.floor(remaining / MILESTONE_M)
    if (milestone < this.milestone) {
      this.milestone = milestone
      // Skipped right before a turn warning, so the two don't run together.
      if (!say.length && remaining > PREPARE_M * 3 && toTurn > PREPARE_M * 2) say.push(`${distance(remaining)} to go.`)
    }

    // Walking away from the path: only checked while moving (GPS course), told from the compass.
    if (course !== null && heading !== null && !say.length && toTurn > TURN_M * 2 && hit.along > 10) {
      const rel = relative(hit.heading, heading)
      if (Math.abs(rel) > VEER_DEG) {
        if (++this.veerFixes >= VEER_FIXES && at - this.lastVeer > VEER_COOLDOWN_MS) {
          this.veerFixes = 0
          this.lastVeer = at
          return { kind: 'veer', text: `You’re drifting off the path. ${capitalFirst(walkPhrase(rel))}.`, priority: 1 }
        }
      } else this.veerFixes = 0
    }

    return say.length ? { kind, text: say.join(' '), priority } : null
  }
}

// ---- Compass ---------------------------------------------------------------------------------

type OrientationEvent = DeviceOrientationEvent & { webkitCompassHeading?: number }

/**
 * Compass heading (0–360) of the way the back camera points, from a device orientation event.
 * iPhones give it directly; elsewhere it's worked out from alpha/beta/gamma (absolute events only).
 * Held upright on the chest, the camera faces where the walker faces.
 */
export function headingFrom(e: OrientationEvent): number | null {
  if (typeof e.webkitCompassHeading === 'number' && !Number.isNaN(e.webkitCompassHeading)) return e.webkitCompassHeading
  if (!e.absolute || e.alpha === null || e.beta === null || e.gamma === null) return null
  const [a, b, g] = [rad(e.alpha), rad(e.beta), rad(e.gamma)]
  // The back camera's direction (device -Z) in east/north coordinates.
  const east = -Math.cos(a) * Math.sin(g) - Math.sin(a) * Math.sin(b) * Math.cos(g)
  const north = -Math.sin(a) * Math.sin(g) + Math.cos(a) * Math.sin(b) * Math.cos(g)
  // Lying flat, the camera points at the ground: use the top of the phone instead.
  if (Math.hypot(east, north) < 0.5) return (360 - e.alpha) % 360
  return (deg(Math.atan2(east, north)) + 360) % 360
}

let compassAsked = false
/** iPhones only share the compass after asking, inside a tap. Call it from a tap handler. */
export function askCompass() {
  if (compassAsked) return
  compassAsked = true
  const ask = (globalThis.DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> } | undefined)?.requestPermission
  ask?.call(DeviceOrientationEvent).catch(() => {})
}
