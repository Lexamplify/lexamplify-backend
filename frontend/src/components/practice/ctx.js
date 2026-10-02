import { createContext, useContext } from 'react';

export const PracticeContext = createContext(null);
export const usePractice = () => useContext(PracticeContext);
