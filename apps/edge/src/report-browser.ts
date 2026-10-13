// The report's PDF is laid out in the organizer's own browser, from data the page fetches in small pieces: this is the only thing the page needs from our code.
import { layoutReport, layoutPeoplePart } from "./report-layout";
(globalThis as any).RPT = { layoutReport, layoutPeoplePart };
