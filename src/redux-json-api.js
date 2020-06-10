import isRequired from '@fuelrats/argument-validator-utils/isRequired'
import { produce } from 'immer'

const JSONAPI_SCOPE = '__jsonapi'
const CREATES_RELATIONSHIP = `${JSONAPI_SCOPE}/create/relationship`
const DELETES_RELATIONSHIP = `${JSONAPI_SCOPE}/delete/relationship`
const DELETES_RESOURCE = `${JSONAPI_SCOPE}/delete/resource`
const RESOURCE = `${JSONAPI_SCOPE}/resource-linkage`

export default function createJSONAPIReducer (reducerId, config) {
  const resolveResourceConfig = (resource) => {
    if (!resource || !config[resource.type]) {
      return undefined
    }

    return {
      target: resource.type,
      mergeMethod: Object.assign,
      ...config[resource.type],
    }
  }

  const insertResource = (draftState, resourceConfig, resource) => {
    if (!resourceConfig || !resource) {
      return
    }

    const {
      target: type,
      mergeMethod,
      reducer,
    } = resourceConfig
    const { id } = resource

    draftState[type][id] = mergeMethod(
      draftState[type][id] ?? {},
      reducer ? reducer(resource) : resource,
    )
  }

  const insertResourceList = (draftState, resources = []) => {
    const resourceConfig = resolveResourceConfig(resources[0])
    if (!resourceConfig) {
      return
    }
    resources.forEach((resource) => {
      insertResource(draftState, resourceConfig, resource)
    })
  }

  const insertIncludedResources = (draftState, resources = []) => {
    resources.forEach((resource) => {
      insertResource(
        draftState,
        resolveResourceConfig(resource),
        resource,
      )
    })
  }

  const deleteResource = (draftState, { type, id }) => {
    if (!config[type]) {
      // prevent overreach into uncontrolled state members
      return
    }
    delete draftState[type][id]
  }

  const mapModifiedRelationshipData = (draftState, resources, callback) => {
    resources.forEach((resource) => {
      const {
        type,
        id,
        relationships,
      } = resource

      if (!config[type] || !draftState[type] || !draftState[type][id]) {
        return
      }

      Object.entries(relationships).forEach(([relationshipKey, relationshipData]) => {
        const targetResourceRelationship = draftState[type][id].relationships[relationshipKey]

        if (!targetResourceRelationship) {
          throw new Error(`Attempted to update a relationship that does not exist for resource type ${type}`)
        }

        if (Array.isArray(targetResourceRelationship.data)) {
          if (!Array.isArray(relationshipData)) {
            throw new TypeError('Relationship update data for to-many relationships MUST be an array.')
          }
        } else if (Array.isArray(relationshipData)) {
          throw new TypeError('Relationship update data for to-one relationships MUST NOT be an array.')
        }

        draftState[type][id].relationships[relationshipKey].data = callback(targetResourceRelationship.data, relationshipData)
      })
    })
  }

  return produce((draftState, action) => {
    // Don't reduce action if the action doesn't request it, or there's an error.
    if (action.meta?.[JSONAPI_SCOPE] !== reducerId || action.error) {
      return
    }

    // reduce any included resources
    if (action.payload?.included) {
      insertIncludedResources(draftState, action.payload.included)
    }

    // reduce any resources in data
    const payloadData = action.payload?.data
    if (payloadData) {
      if (Array.isArray(payloadData)) {
        insertResourceList(draftState, payloadData)
      } else {
        insertResource(draftState, resolveResourceConfig(payloadData), payloadData)
      }
    }

    // If a resource was deleted, delete it.
    const deletedResource = action.meta[DELETES_RESOURCE]
    if (deletedResource) {
      deleteResource(draftState, deletedResource)
    }

    // generate new relationship links
    const newRelationships = action.meta[CREATES_RELATIONSHIP]
    if (newRelationships) {
      mapModifiedRelationshipData(draftState, newRelationships, (targetData, newData) => {
        if (Array.isArray(targetData)) {
          return [
            ...targetData,
            ...newData.map((newLink) => {
              return newData === RESOURCE
                ? { type: action.payload.data.type, id: action.payload.data.id }
                : newLink
            }),
          ]
        }
        return newData === RESOURCE
          ? { type: action.payload.data.type, id: action.payload.data.id }
          : newData
      })
    }

    // remove old relationship links
    const deletedRelationships = action.meta[DELETES_RELATIONSHIP]
    if (deletedRelationships) {
      mapModifiedRelationshipData(draftState, deletedRelationships, (targetData, deletedData) => {
        if (Array.isArray(targetData)) {
          return targetData.reduce((acc, existingLink) => {
            if (deletedData.find((deletedLink) => {
              return deletedLink.type === existingLink.type && deletedLink.id === existingLink.id
            })) {
              return acc
            }

            acc.push(existingLink)
            return acc
          }, [])
        }
        return null
      })
    }
  })
}

export function updatesResources (reducerId) {
  return {
    [JSONAPI_SCOPE]: reducerId,
  }
}

export function deletesResource (reducerId, { type, id }) {
  return {
    [JSONAPI_SCOPE]: reducerId,
    [DELETES_RESOURCE]: { type, id },
  }
}

export function createsRelationship (...relations) {
  return {
    [CREATES_RELATIONSHIP]: relations,
  }
}

export function deletesRelationship (...relations) {
  return {
    [DELETES_RELATIONSHIP]: relations,
  }
}

export function defineRelationship (
  type = isRequired('type'),
  id = isRequired('id'),
  relationships = isRequired('relationships'),
) {
  return { type, id, relationships }
}