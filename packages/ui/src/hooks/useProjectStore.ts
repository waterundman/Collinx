import { useContext } from "react";
import { ProjectStoreContext, type ProjectStoreValue } from "../store/project-store";

export function useProjectStore(): ProjectStoreValue {
  const ctx = useContext(ProjectStoreContext);
  if (!ctx) {
    throw new Error(
      "useProjectStore must be used within a <ProjectProvider>. " +
        "Wrap your component tree with ProjectProvider at the root."
    );
  }
  return ctx;
}

export default useProjectStore;
