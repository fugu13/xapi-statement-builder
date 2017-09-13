import { StatementBuilder, AgentBuilder } from '../src/builder';

import * as _ from "lodash";
import * as jsc from "jsverify";
import * as generators from "./generators";


describe("builder", () => {
    jsc.property("double setting response doesn't change the output", jsc.string, (response) => {
        const once = StatementBuilder.builder().withResponse(response);
        const twice = once.withResponse(response);

        return _.isEqual(once.build(), twice.build());
    });

    jsc.property("agents work both ways", generators.email, (email) => {
        const direct = StatementBuilder.builder().withInstructorEmail(email);
        const agent = AgentBuilder.builder().withEmail(email);
        return _.isEqual(direct.build().context.instructor.mbox, agent.build().mbox);
    });

    jsc.property("agents work!", generators.agent, (agent) => {
        // console.log("found agent!", agent);
        // return (agent.member || []).length < 2;
        return true;
    });

    jsc.property("agent statements work!", generators.agent_statement, (statement) => {
        return _.every([statement.verb.id, statement.object, statement.actor]);
    });
});
