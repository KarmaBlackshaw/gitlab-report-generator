const axios = require('axios')
const _ = require('lodash')
const Promise = require('bluebird')
const ms = require('ms')

const fs = Promise.promisifyAll(require('fs'))

const { PROJECT_FILE_PATH } = require('../constants')

const ACCESS_TOKEN = process.env.ACCESS_TOKEN

async function getGroups () {
  const {
    data: groups
  } = await axios.get('https://gitlab.com/api/v4/groups/', {
    params: {
      top_level_only: false,
      access_token: ACCESS_TOKEN
    }
  })

  const response = await Promise.map(groups, async group => {
    try {
      const { data } = await axios.get(`https://gitlab.com/api/v4/groups/${group.id}/subgroups`, {
        params: {
          access_token: ACCESS_TOKEN,
          all_available: true
        }
      })

      return data.map(subgroup => ({
        id: subgroup.id,
        name: subgroup.name,
        web_url: subgroup.web_url
      }))
    } catch (error) {
      console.log(error)
      throw error
    }
  }, {
    concurrency: 3
  })

  const mainGroups = groups.map(group => ({
    id: group.id,
    name: group.name,
    web_url: group.web_url
  }))

  return _.flatten(response)
    .concat(mainGroups)
}

async function run () {
  console.log('Fetching projects')

  const groups = await getGroups()

  const promises = groups.flatMap(group => {
    return [
      axios.get(`https://gitlab.com/api/v4/groups/${group.id}/projects`, {
        params: {
          access_token: ACCESS_TOKEN,
          include_subgroups: true
        }
      }),
      axios.get(`https://gitlab.com/api/v4/groups/${group.id}/projects`, {
        params: {
          access_token: ACCESS_TOKEN
        }
      })
    ]
  })

  const list = await Promise.map(
    promises,
    ({ data: projects }) => {
      return projects.map(project => ({
        id: project.id,
        path_with_namespace: project.path_with_namespace
      }))
    },
    {
      concurrency: 5
    }
  )

  const projects = _.uniqBy(_.flatten(list), 'id')

  await fs.writeFileAsync(
    PROJECT_FILE_PATH,
    JSON.stringify(projects, null, 2)
  )
}

setInterval(() => {
  run()
}, ms('1 minute'))
