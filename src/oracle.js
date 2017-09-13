import { Record, OrderedSet, fromJS } from 'immutable';

export let uriOracle = {
    lookup(identifier, objectType) {
        if(identifier.indexOf(':') != -1) {
            return {
                id: identifier
            }
        }
    },

    search(query, objectType) {
        return [];
    }
};

const ProfileOracleBase = Record({
    profile: null
});

export class ProfileOracle extends ProfileOracleBase {

    matcher(identifier, objectType) {
        identifier = identifier.lower();
        objectTypes = new Set(objectType ? [objectType] :
            ['Activity', 'Verb', 'ActivityType', 'AttachmentUsageType', 'Extension']);
        return (concept) => objectTypes.has(concept.type) &&
            Object.values(concept.prefLabel).some(function(value) {
                return value.lower() == identifier;
            });
    }



    lookup(identifier, objectType) {
        const matching = this.profile.concepts.filter(this.matcher(identifier, objectType));
        if(matching.length == 1) { // only return unambiguous matches
            return matching[0];
        }

    }

    search(query, objectType) {

    }

    static fromProfile(profile) {
        return new ProfileOracle({
            profile: fromJS(profile)
        });
    }
}


const CompositeOracleBase = Record({
    oracles: OrderedSet()
});

export class CompositeOracle extends CompositeOracleBase {

    add(oracle) {
        return this.updateIn(['oracles'], oracles => oracles.add(oracle));
    }

    lookup(identifier, objectType) {
        for(let oracle of this.oracles.reverse()) {
            const result = oracle.lookup(identifier, objectType);
            if(result) {
                return result;
            }
        }
        // return what?
    }

    // is this order good (enough)?
    // if we keep adding profiles in separate oracles... doesn't
    // that lead to bad ordering? Create a Profile Oracle that always works the same?
    // bleh
    // hmm, instead of just an array some sort of object keyed by source?
    search(query, objectType) {
        let results = [];
        for(let oracle of this.oracles.reverse()) {
            results = results.concat(oracle.search(query, objectType));
        }
        return results;
    }
}
