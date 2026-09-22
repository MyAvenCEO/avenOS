import {
	StudioActor as SharedStudioActor,
	type StudioAgentRequest
} from '@avenos/actors/studio/agent'
import { studioCaseRequest } from '../skills/studio-case-context'
import { authorizedStudioRequest } from '../skills/studio-request'

/** Native transport and presentation only; authoring lives in the shared Actor. */
export class StudioActor extends SharedStudioActor {
	constructor(request: StudioAgentRequest = authorizedStudioRequest) {
		super(request, (artifactId) => studioCaseRequest.set(artifactId))
	}
}
