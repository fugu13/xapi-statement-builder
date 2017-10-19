import { StatementBuilder, AgentBuilder, ProfileRegistration } from '../src/builder';

import * as chai from "chai";
import * as _ from "lodash";
import * as jsc from "jsverify";
import * as generators from "./generators";


const should = chai.should();

describe("profiles", () => {
    it("should fail when an included rule is missing", () => {
        const statement = StatementBuilder.builder().templated({
            id: "http://template.example.com",
            inScheme: "http://version.example.com",
            type: "StatementTemplate",
            rules: [{
                location: "$.result.success",
                presence: "included"
            }]
        }).withActorEmail("orange@example.org");
        (() => statement.build()).should.throw();
        (() => statement.asSucceeded().build()).should.not.throw();
    });

    it("should apply a template used as part of a pattern", () => {
        const profile = ProfileRegistration.builder().withProfile({
            id: "http://profile.example.com",
            versions: [{
                id: "http://version.example.com"
            }],
            patterns: [{
                id: "http://pattern.example.com",
                inScheme: "http://version.example.com",
                prefLabel: {
                    "en": "A Pattern"
                },
                type: "Pattern",
                zeroOrMore: "http://template.example.com"
            }],
            templates: [{
                id: "http://template.example.com",
                inScheme: "http://version.example.com",
                prefLabel: {
                    "en": "A Template"
                },
                type: "StatementTemplate",
                rules: [{
                    location: "$.result.success",
                    presence: "included"
                }]
            }]
        });
        const pattern = profile.pattern("A Pattern");
        const statement = profile.template("A Template", pattern);
        (() => statement.build()).should.throw();
        (() => statement.asSucceeded().build()).should.not.throw();
    });

    it("should reject the wrong template used as part of a pattern", () => {
        const profile = ProfileRegistration.builder().withProfile({
            id: "http://profile.example.com",
            versions: [{
                id: "http://version.example.com"
            }],
            patterns: [{
                id: "http://pattern.example.com",
                inScheme: "http://version.example.com",
                prefLabel: {
                    "en": "A Pattern"
                },
                type: "Pattern",
                // NOTE: different from the only template in templates
                zeroOrMore: "http://template2.example.com"
            }],
            templates: [{
                id: "http://template.example.com",
                inScheme: "http://version.example.com",
                prefLabel: {
                    "en": "A Template"
                },
                type: "StatementTemplate"
            }]
        });
        const pattern = profile.pattern("A Pattern");
        (() => profile.template("A Template", pattern)).should.throw();
    });
})


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

    jsc.property("agent statements work!", generators.agent_statement, (statement) => {
        return _.every([statement.verb.id, statement.object, statement.actor]);
    });
});
