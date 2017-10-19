import { Record, OrderedSet, fromJS, List } from 'immutable';

/**
* @ignore
*/
export let uriOracle = {
    lookup(identifier, objectType) {
        if(identifier.indexOf(':') != -1) {
            return {
                id: identifier
            }
        }
    },
};

/**
* @ignore
*/
const ProfileOracleBase = Record({
    profile: null
});

/**
* @ignore
*/
export class ProfileOracle extends ProfileOracleBase {

    matcher(identifier, objectType) {
        identifier = identifier.toLowerCase();
        const objectTypes = new Set([objectType]);
        return (concept) => {
            return objectTypes.has(concept.get('type')) && (
                concept.get('id').toLowerCase() == identifier ||
                concept.get('prefLabel').some(function(value) {
                    return value.toLowerCase() == identifier;
                }));
        }
    }

    lookup(identifier, objectType) {
        const matching = this.profile.get('lookups').filter(
            this.matcher(identifier, objectType));
        if(matching.count() == 1) { // only return unambiguous matches
            return matching.get(0).toJS();
        }

    }

    static fromProfile(profile) {
        return new ProfileOracle({
            profile: fromJS({
                concepts: [], // empty defaults
                templates: [],
                patterns: []
            }).merge(fromJS(profile))
        }).update('profile', (profile) => {
            const lookups = new List().concat(
                profile.get("concepts"),
                profile.get("templates"),
                profile.get("patterns")
            );
            return profile.set('lookups', lookups);
        });
    }
}

/**
* @ignore
*/
const CompositeOracleBase = Record({
    oracles: OrderedSet()
});

/**
* @ignore
*/
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
        // return something else? raise? Currently the lookup method on
        // Builders raises if nothing is returned
    }
}
