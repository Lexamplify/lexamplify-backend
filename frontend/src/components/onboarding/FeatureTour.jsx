import { Joyride, STATUS, ACTIONS } from 'react-joyride';
import useOnboardingStore from '../../stores/useOnboardingStore.js';
import TOUR_SECTIONS from './tourSteps.js';

const joyrideStyles = {
  options: { primaryColor: '#2563C9', zIndex: 10002, arrowColor: 'var(--paper, #fff)' },
  spotlight: { borderRadius: 10 },
  tooltip: { borderRadius: 14, padding: '20px 18px 16px', fontFamily: 'system-ui, -apple-system, sans-serif' },
  tooltipTitle: { fontSize: 16, fontWeight: 700 },
  tooltipContent: { fontSize: 13.5, lineHeight: 1.55, padding: '8px 0 0' },
  buttonNext: { borderRadius: 8, fontSize: 13, fontWeight: 600, padding: '8px 18px' },
  buttonBack: { borderRadius: 8, fontSize: 13, color: '#64748b', marginRight: 8 },
  buttonSkip: { borderRadius: 8, fontSize: 12, color: '#94a3b8' },
  buttonClose: { top: 10, right: 10 },
};

export default function FeatureTour() {
  const { tourRunning, tourSection, stopTour, markTourSeen, completeWizard } = useOnboardingStore();

  if (!tourRunning || !tourSection) return null;

  const section = TOUR_SECTIONS[tourSection];
  if (!section) return null;

  const handleCallback = (data) => {
    const { status, action } = data;
    const done = status === STATUS.FINISHED || status === STATUS.SKIPPED || action === ACTIONS.CLOSE;
    if (done) {
      const section = tourSection;
      if (section === 'onboarding') {
        completeWizard().then(() => markTourSeen(section)).then(() => stopTour());
      } else {
        markTourSeen(section).then(() => stopTour());
      }
    }
  };

  return (
    <Joyride
      key={tourSection}
      steps={section.steps}
      run
      continuous
      showSkipButton
      showProgress
      disableOverlayClose
      scrollOffset={80}
      locale={{ back: 'Back', close: 'End', last: 'Done', next: 'Next', skip: 'End Tour' }}
      styles={joyrideStyles}
      onEvent={handleCallback}
    />
  );
}
