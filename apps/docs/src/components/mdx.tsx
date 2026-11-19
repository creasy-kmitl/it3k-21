import { Accordion, Accordions } from "fumadocs-ui/components/accordion";
import { ImageZoom } from "fumadocs-ui/components/image-zoom";
import { Step, Steps } from "fumadocs-ui/components/steps";
import { Tab, Tabs } from "fumadocs-ui/components/tabs";
import defaultMdxComponents from "fumadocs-ui/mdx";
import type { MDXComponents } from "mdx/types";

import { AccountJourney, Diagram, Flow, Node, RightsFormula, SignupGate } from "./diagrams";
import { PageHero, RoleCard, RoleCards } from "./illustration";
import { Screenshot } from "./screenshot";

export function getMDXComponents(components?: MDXComponents) {
  return {
    ...defaultMdxComponents,
    img: (props) => <ImageZoom {...props} />,
    Accordion,
    Accordions,
    Step,
    Steps,
    Tab,
    Tabs,
    Screenshot,
    PageHero,
    RoleCard,
    RoleCards,
    Diagram,
    Flow,
    Node,
    AccountJourney,
    RightsFormula,
    SignupGate,
    ...components,
  } satisfies MDXComponents;
}

export const useMDXComponents = getMDXComponents;

declare global {
  type MDXProvidedComponents = ReturnType<typeof getMDXComponents>;
}
