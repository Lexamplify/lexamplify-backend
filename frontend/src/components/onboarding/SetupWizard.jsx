import { useState, useEffect, useCallback, useRef } from 'react';
import { Joyride, STATUS, ACTIONS } from 'react-joyride';
import { useNavigate, useLocation } from 'react-router-dom';
import useOnboardingStore from '../../stores/useOnboardingStore.js';

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

const GUIDED_STEPS = [
  // 0 — Welcome
  {
    target: 'body',
    title: 'Welcome to LexAmplify',
    content: 'Your digital law chamber is ready! We\'ll walk you through setting up your chamber, adding a client, creating your first matter, and building your team. Takes about 3 minutes.',
    placement: 'center',
  },
  // 1 — Name chamber
  {
    target: '[data-tour="chamber-edit"]',
    title: 'Name your chamber',
    content: 'Click this pencil icon to set your law chamber\'s name. It appears on documents, letterheads, and your team\'s sidebar.',
    placement: 'bottom-end',
    spotlightClicks: true,
    waitFor: 'lx:chamber-saved',
  },
  // 2 — Create client
  {
    target: '[data-tour="workspace-switcher"]',
    title: 'Create your first client',
    content: 'Click this dropdown, then click "+ Add client" at the bottom to create your first client workspace.',
    spotlightClicks: true,
    waitFor: 'lx:workspace-created',
  },
  // 3 — Go to Matters
  {
    target: '[data-tour="nav-matters"]',
    title: 'Go to Matters',
    content: 'Now click "Matters" in the sidebar to open the matters page.',
    spotlightClicks: true,
    navigateTo: '/matters',
  },
  // 4 — Create matter
  {
    target: '[data-tour="new-matter-btn"]',
    title: 'Create your first matter',
    content: 'Click "New matter" to create a case for your client. Each matter tracks hearings, documents, and deadlines.',
    spotlightClicks: true,
    waitFor: 'lx:matter-created',
  },
  // 5 — Go to Settings → Team
  {
    target: '[data-tour="settings-link"]',
    title: 'Go to Settings',
    content: 'Click your profile to go to Settings — we\'ll set up your team.',
    spotlightClicks: true,
    navigateTo: '/settings',
    navigateHash: '#team',
  },
  // 6 — Spotlight Team tab (informational, auto-advances after showing)
  {
    target: '[data-tour="settings-tab-team"]',
    title: 'The Team tab',
    content: 'This is the Team tab — manage your members and groups here. Let\'s add your first team member.',
    spotlightClicks: true,
    autoClickTarget: '[data-tour="settings-tab-team"]',
  },
  // 7 — Click Add member
  {
    target: '[data-tour="add-member-btn"]',
    title: 'Add your first team member',
    content: 'Click "Add member" to invite someone. If they already have an account, they\'ll be linked. If not, a new account is created and you\'ll get their login credentials to share.',
    spotlightClicks: true,
    waitFor: 'lx:member-added',
    optional: true,
  },
  // 8 — Go back to Matters to create a team group
  {
    target: '[data-tour="nav-matters"]',
    title: 'Create a team group',
    content: 'Go back to Matters — we\'ll create a team group so you can organize who sees which cases.',
    spotlightClicks: true,
    navigateTo: '/matters',
  },
  // 9 — Click New team
  {
    target: '[data-tour="new-team-btn"]',
    title: 'Create a team group',
    content: 'Click "New team" to create a group (e.g. "Corporate", "Family Law"). Matters tagged with this group will be visible to everyone in it.',
    spotlightClicks: true,
    waitFor: 'lx:team-created',
  },
  // 10 — Go to Settings → Team for groups
  {
    target: '[data-tour="settings-link"]',
    title: 'Manage your groups',
    content: 'Go back to Settings to assign team members to the group you just created.',
    spotlightClicks: true,
    navigateTo: '/settings',
    navigateHash: '#team',
  },
  // 11 — Spotlight Team tab for groups (informational)
  {
    target: '[data-tour="settings-tab-team"]',
    title: 'Team tab — Groups section',
    content: 'Scroll down to the Groups section to manage who\'s in each group.',
    spotlightClicks: true,
    autoClickTarget: '[data-tour="settings-tab-team"]',
  },
  // 12 — Click Manage members
  {
    target: '[data-tour="manage-group-btn"]',
    title: 'Manage group members',
    content: 'Click "Manage members" to add people to this group. Anyone in the group can see matters tagged with it.',
    spotlightClicks: true,
    waitFor: 'lx:group-member-added',
    optional: true,
  },
  // 13 — Go back to Matters to assign team
  {
    target: '[data-tour="nav-matters"]',
    title: 'Assign team to your matter',
    content: 'Go back to Matters — we\'ll tag your matter with the team group you just set up.',
    spotlightClicks: true,
    navigateTo: '/matters',
  },
  // 14 — Click "+ Add to team" on the matter
  {
    target: '[data-tour="add-to-team-btn"]',
    title: 'Add your matter to a team',
    content: 'Click "+ Add to team" on your matter. Pick the group you created and click Assign. Everyone in that group will see this matter.',
    spotlightClicks: true,
    waitFor: 'lx:team-assigned',
  },
  // 15 — Explore: Contract Analyzer
  {
    target: '[data-tour="nav-contract-analyzer"]',
    title: 'Contract Analyzer',
    content: 'Upload any contract or legal document here — AI highlights risks, missing clauses, and suggests improvements.',
  },
  // 16 — Explore: Auto-Draft Studio
  {
    target: '[data-tour="nav-auto-draft"]',
    title: 'Auto-Draft Studio',
    content: 'Draft legal documents from templates — petitions, replies, affidavits, and more. AI fills in the details from your matter data.',
  },
  // 17 — Explore: Legal Calendar
  {
    target: '[data-tour="nav-calendar"]',
    title: 'Legal Calendar',
    content: 'Track all your hearing dates, deadlines, and appointments in one place. Syncs with your matters automatically.',
  },
  // 18 — Done!
  {
    target: 'body',
    title: 'You\'re all set!',
    content: 'Your chamber is fully configured — clients, matters, team members, groups, and team assignments are all in place. Your juniors and staff will only see matters tagged with their group. Explore the sidebar for more tools, and click the ? button anytime to revisit this walkthrough!',
    placement: 'center',
    isFinal: true,
  },
];

export default function SetupWizard() {
  const { showWizard, completeWizard, startTour, updateOnboarding, onboarding } = useOnboardingStore();
  const navigate = useNavigate();
  const location = useLocation();
  const [stepIndex, setStepIndexRaw] = useState(() => onboarding?.wizard_step || 0);
  const [run, setRun] = useState(false);
  const [waitingForEvent, setWaitingForEvent] = useState(null);
  const pauseRef = useRef(false);

  const setStepIndex = useCallback((valOrFn) => {
    setStepIndexRaw((prev) => {
      const next = typeof valOrFn === 'function' ? valOrFn(prev) : valOrFn;
      if (next !== prev) updateOnboarding({ wizard_step: next });
      return next;
    });
  }, [updateOnboarding]);

  // Start (or restart) the wizard
  useEffect(() => {
    if (!showWizard) return;
    setStepIndexRaw(onboarding?.wizard_step || 0);
    setWaitingForEvent(null);
    window.__lxOnboardingActive = true;
    const t = setTimeout(() => setRun(true), 600);
    return () => { clearTimeout(t); window.__lxOnboardingActive = false; };
  }, [showWizard]);

  const advanceToNext = useCallback((fromIndex) => {
    const next = fromIndex + 1;
    if (next >= GUIDED_STEPS.length) {
      setRun(false);
      completeWizard();
      return;
    }
    const nextStep = GUIDED_STEPS[next];
    if (nextStep?.isFinal) {
      completeWizard().then(() => {
        setStepIndex(next);
        setTimeout(() => setRun(true), 300);
      });
      return;
    }
    setRun(false);
    setTimeout(() => {
      setStepIndex(next);
      setRun(true);
    }, 300);
  }, [completeWizard, setStepIndex]);

  // Listen for waitFor events
  useEffect(() => {
    if (!waitingForEvent) return;
    const handler = () => {
      setWaitingForEvent(null);
      setStepIndexRaw((i) => {
        const next = i + 1;
        if (next >= GUIDED_STEPS.length) {
          completeWizard();
          return i;
        }
        const nextStep = GUIDED_STEPS[next];
        if (nextStep?.isFinal) {
          completeWizard();
        }
        updateOnboarding({ wizard_step: next });
        return next;
      });
      setTimeout(() => setRun(true), 400);
    };
    window.addEventListener(waitingForEvent, handler);
    return () => window.removeEventListener(waitingForEvent, handler);
  }, [waitingForEvent, completeWizard, updateOnboarding]);

  // Wait for DOM target to appear
  useEffect(() => {
    if (!showWizard || !run) return;
    const step = GUIDED_STEPS[stepIndex];
    if (!step || step.target === 'body') return;
    if (document.querySelector(step.target)) return;

    const isOptional = step.optional;
    setRun(false);
    let elapsed = 0;
    const interval = setInterval(() => {
      elapsed += 300;
      if (document.querySelector(step.target)) {
        clearInterval(interval);
        setTimeout(() => setRun(true), 200);
      } else if (isOptional && elapsed > 3000) {
        clearInterval(interval);
        advanceToNext(stepIndex);
      }
    }, 300);
    return () => clearInterval(interval);
  }, [stepIndex, run, showWizard, location.pathname, advanceToNext]);

  // Auto-click target element when step has autoClickTarget (e.g. Team tab)
  useEffect(() => {
    if (!run || !showWizard) return;
    const step = GUIDED_STEPS[stepIndex];
    if (!step?.autoClickTarget) return;
    const el = document.querySelector(step.autoClickTarget);
    if (el) el.click();
  }, [run, stepIndex, showWizard]);

  // For waitFor steps: auto-hide the tooltip after 2.5s so the user can
  // interact with the real UI without needing to click away first.
  useEffect(() => {
    if (!run || !showWizard) return;
    const step = GUIDED_STEPS[stepIndex];
    if (!step?.waitFor) return;

    const timer = setTimeout(() => {
      setRun(false);
      setWaitingForEvent(step.waitFor);
    }, 2500);
    return () => clearTimeout(timer);
  }, [run, stepIndex, showWizard]);

  const handleEvent = useCallback((data) => {
    const { action, status, index, type } = data;

    if (status === STATUS.SKIPPED) {
      setRun(false);
      completeWizard();
      return;
    }

    if (action === ACTIONS.CLOSE) {
      const step = GUIDED_STEPS[index];
      if (step?.waitFor) {
        setRun(false);
        setWaitingForEvent(step.waitFor);
        return;
      }
      if (step?.isFinal) {
        setRun(false);
        return;
      }
      setRun(false);
      completeWizard();
      return;
    }

    if (type === 'step:after') {
      if (pauseRef.current) return;
      pauseRef.current = true;
      setTimeout(() => { pauseRef.current = false; }, 400);

      const step = GUIDED_STEPS[index];

      if (step.isFinal) {
        setRun(false);
        return;
      }

      if (step.waitFor) {
        setRun(false);
        setWaitingForEvent(step.waitFor);
        return;
      }

      if (step.navigateTo) {
        const target = step.navigateTo + (step.navigateHash || '');
        navigate(target);
        setRun(false);
        setTimeout(() => {
          setStepIndex(index + 1);
          setRun(true);
        }, 600);
        return;
      }

      advanceToNext(index);
    }
  }, [completeWizard, navigate, setStepIndex, advanceToNext]);

  if (!showWizard) return null;

  const currentStep = GUIDED_STEPS[stepIndex];
  const currentIsWaitStep = !!currentStep?.waitFor;

  const joySteps = GUIDED_STEPS.map((s) => ({
    target: s.target,
    title: s.title,
    content: s.waitFor
      ? s.content + '\n\n👆 Go ahead — click it now!'
      : s.content,
    placement: s.placement || 'bottom',
    spotlightClicks: s.spotlightClicks ?? false,
    skipBeacon: true,
    hideBackButton: true,
  }));

  return (
    <>
      {currentIsWaitStep && (
        <style>{`
          .react-joyride__floater [data-action="primary"],
          .react-joyride__floater [data-action="back"],
          .react-joyride__floater [data-action="skip"] { display: none !important; }
          .react-joyride__floater { pointer-events: none !important; }
          .react-joyride__overlay { pointer-events: none !important; }
        `}</style>
      )}
      <Joyride
        steps={joySteps}
        stepIndex={stepIndex}
        run={run}
        continuous
        showSkipButton
        disableOverlayClose
        scrollOffset={80}
        spotlightPadding={6}
        locale={{ skip: 'Skip setup', next: 'Let\'s go!', last: 'Done!', close: 'End' }}
        styles={joyrideStyles}
        onEvent={handleEvent}
      />
    </>
  );
}
