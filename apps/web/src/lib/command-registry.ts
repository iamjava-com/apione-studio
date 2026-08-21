import { createContext, useContext, useEffect } from 'react';
import type { Command } from '../components/CommandPalette';

/** Lets a mounted view (e.g. the open project) contribute searchable commands to the
 *  app-level ⌘K palette; the contribution clears when that view unmounts. */
export const RegisterCommandsContext = createContext<(commands: Command[]) => void>(() => {});

export function useRegisterCommands(commands: Command[]) {
  const register = useContext(RegisterCommandsContext);
  useEffect(() => {
    register(commands);
    return () => register([]);
  }, [commands, register]);
}
