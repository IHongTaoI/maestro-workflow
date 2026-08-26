export const ROLE_DEFINITIONS = {
  tpm: {
    remember: ["scope", "acceptance criteria", "confirmed requirements", "open questions"],
    forget: ["repeated discussion", "superseded wording"],
  },
  laborer: {
    remember: ["confirmed findings", "evidence paths", "excluded hypotheses", "next investigation"],
    forget: ["search commands", "irrelevant files", "duplicate logs"],
  },
  architect: {
    remember: ["system boundaries", "constraints", "interfaces", "decisions", "risks"],
    forget: ["unselected ideas without lasting value"],
  },
  orchestrator: {
    remember: ["task dependencies", "parallel safety", "write sets", "blocked work"],
    forget: ["temporary scheduling chatter"],
  },
  coder: {
    remember: ["changed files", "interface changes", "todo items", "test state", "blockers"],
    forget: ["mechanical edit narration", "discarded patches"],
  },
  "test-designer": {
    remember: ["risk coverage", "test cases", "fixtures", "acceptance mapping"],
    forget: ["duplicate test ideas"],
  },
  "test-runner": {
    remember: ["environment", "executed tests", "results", "failures", "remaining checks"],
    forget: ["duplicate command output"],
  },
  delivery: {
    remember: ["delivered artifacts", "verification status", "known limitations", "follow-ups"],
    forget: ["internal narration"],
  },
};
