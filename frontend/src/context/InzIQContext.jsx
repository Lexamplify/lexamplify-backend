import { createContext, useContext } from 'react';

export const InzIQContext = createContext({
  wakeState:         'idle',
  currentDictation:  '',
});

export const useInzIQ = () => useContext(InzIQContext);
