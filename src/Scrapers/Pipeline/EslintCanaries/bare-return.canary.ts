// Canary: ReturnStatement[argument=null] — bare return; must be caught
const earlyExit = () => {
  return;
};

export { earlyExit };
