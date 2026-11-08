// SVGs exported from the Figma file (GuideSight — Mobile Web Prototype, page "v6 · Headspace style").
import a11yBlue from './assets/a11y-26-blue.svg'
import a11yWhite from './assets/a11y-24-white.svg'
import camera60 from './assets/camera-60.svg'
import catDescribe from './assets/cat-describe.svg'
import catFind from './assets/cat-find.svg'
import catGuide from './assets/cat-guide.svg'
import catRead from './assets/cat-read.svg'
import chat44 from './assets/chat-44.svg'
import checkGreen from './assets/check-16-green.svg'
import checkWhite from './assets/check-16-white.svg'
import check44 from './assets/check-44-green.svg'
import chevLeft from './assets/chev-left-22.svg'
import chevRight from './assets/chev-right-18.svg'
import dogAlert1 from './assets/dog-alert-1.svg'
import dogAlert2 from './assets/dog-alert-2.svg'
import dogHappy1 from './assets/dog-happy-1.svg'
import dogHappy2 from './assets/dog-happy-2.svg'
import dogListen1 from './assets/dog-listen-1.svg'
import dogListen2 from './assets/dog-listen-2.svg'
import hand20 from './assets/hand-20.svg'
import hand44 from './assets/hand-44.svg'
import keyboard from './assets/keyboard-22.svg'
import mail44 from './assets/mail-44.svg'
import mic14 from './assets/mic-14-gray.svg'
import mic16 from './assets/mic-16-gray.svg'
import mic18Blue from './assets/mic-18-blue.svg'
import mic20 from './assets/mic-20.svg'
import mic22White from './assets/mic-22-white.svg'
import mic60 from './assets/mic-60.svg'
import msg18 from './assets/msg-18.svg'
import radar1 from './assets/radar-1.svg'
import radar2 from './assets/radar-2.svg'
import radioOn from './assets/radio-on.svg'
import scene from './assets/scene.svg'
import search from './assets/search-22.svg'
import sliders from './assets/sliders-22.svg'
import tabAsk from './assets/tab-ask.svg'
import tabGuide from './assets/tab-guide.svg'
import tabToday from './assets/tab-today.svg'
import tabYou from './assets/tab-you.svg'
import user22 from './assets/user-22.svg'
import vibrate from './assets/vibrate-20.svg'
import volume16White from './assets/volume-16-white.svg'
import volume18Black from './assets/volume-18-black.svg'
import volume18White from './assets/volume-18-white.svg'
import x22 from './assets/x-22.svg'

export const icons = {
  a11yBlue, a11yWhite, camera60, catDescribe, catFind, catGuide, catRead, chat44, checkGreen, checkWhite,
  check44, chevLeft, chevRight, hand20, hand44, keyboard, mail44, mic14, mic16, mic18Blue, mic20, mic22White,
  mic60, msg18, radar1, radar2, radioOn, scene, search, sliders, tabAsk, tabGuide, tabToday, tabYou, user22,
  vibrate, volume16White, volume18Black, volume18White, x22,
}

/** Sighty's mood frames, with each frame's offset/size inside the 200×200 component box. */
export const dogFrames = {
  Happy: [
    { src: dogHappy1, left: 0, top: 0, w: 200, h: 200 },
    { src: dogHappy2, left: 0, top: 3, w: 200, h: 203 },
  ],
  Listening: [
    { src: dogListen1, left: 0, top: 0, w: 200, h: 200 },
    { src: dogListen2, left: 0, top: 0, w: 200, h: 200 },
  ],
  Alert: [
    { src: dogAlert1, left: 0, top: 0, w: 200, h: 200 },
    { src: dogAlert2, left: 5, top: 0, w: 205, h: 200 },
  ],
} as const
